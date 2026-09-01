import {
  CHAR_INDEX,
  easeInOutQuad,
  glyphAt,
  hash2,
  highlightAt,
  ringAt,
  toneAt,
} from "./glyphGrid.ts";

/* Geometry: a stack of rings that drift upward
   and wrap, scaled to a sphere silhouette, twisted along the stack, with two
   highlight bands sweeping the surface. Ours draws characters instead of a
   mapped text texture, and the field churns faster the harder the globe is
   turning — see globeDrag.ts for where that spin comes from.

   This module is pure: it turns a moment in time into a flat buffer of quad
   instances. Nothing here touches the DOM or a GL context, so the whole look
   is testable without a GPU. */

/** Rings in the stack, and cells around the widest ring. Narrow rings get
 *  proportionally fewer cells so the glyph density stays even instead of
 *  caking up at the poles. */
export const RINGS = 42;
export const COLS_EQ = 200;
/** Box width the cell count is tuned for; smaller globes thin out with it. */
const COLS_REF_PX = 560;
/** Cap on how tightly a large pane packs — 1 is the 560px look. */
const DENSITY_MAX = 1.6;
/** Total twist across the stack, radians. */
const TWIST = Math.PI;
/** Intro: the collapsed stack opens into the globe over this many seconds. */
export const INTRO_S = 2;
const RING_LOOK = {
  count: RINGS,
  spherify: 1,
  twist: TWIST,
  fadeSize: 0.3,
  fadeSmooth: 0.25,
} as const;
/** Surface spin, turns per second. */
const UV_SPEED = 0.054;
/** Ring conveyor, stack-lengths per second. */
const SHAPE_SPEED = 0.027;
/** Fixed lean on the globe, radians. */
const TILT = (10 * Math.PI) / 180;
/** How far the highlight bands slide with the globe's lean, in turns. */
const HIGHLIGHT_LEAN = 0.06;
/** Camera distance in sphere radii — drives the perspective spread. */
const CAM_Z = 4;
/** Sphere size inside its box. */
const SPHERE_FILL = 0.9;
/** Highlight bands: centre, width and edge softness, in turns. */
const HL_POS = 0.35;
const HL_SIZE = 0.18;
const HL_EDGE = 0.16;
const HL2_POS = 0.72;
const HL2_SIZE = 0.42;
const HL2_EDGE = 0.15;
/** Glyph flips per second at rest, and per rad/s of spin on top of it. */
const AMBIENT_RATE = 0.5;
const SPIN_RATE = 3.6;
/** Monospace cell size at the sphere's equator. */
const FONT_PX = 12;
/** Solid enough to read, not a wash. */
const REST_ALPHA = 1;
const PEAK_ALPHA = 1;
/** How far the back of the globe fades behind the front. */
const BACK_ALPHA = 0.68;
/** Discrete inks — dim, mid, white on charcoal (#232323), matching CA's field. */
const INK = [
  [0.72, 0.72, 0.7],
  [0.9, 0.9, 0.88],
  [1, 1, 1],
] as const;
/** Below this a cell is invisible; drawing it is pure cost. */
const CULL_ALPHA = 0.035;

/** Floats per quad instance: x, y, size, tile, r, g, b, a. */
export const INSTANCE_FLOATS = 8;

/** Worst-case instance count, for sizing the buffer once. */
export const MAX_INSTANCES = RINGS * COLS_EQ * 3;

export type GlobeFrame = {
  /** Sphere diameter in CSS px — may be larger than the pane so it clips. */
  size: number;
  /** Canvas CSS size. Defaults to a square of `size`. */
  width?: number;
  height?: number;
  /** Seconds since the globe mounted. */
  t: number;
  /** Drag-driven orientation, radians. */
  yaw: number;
  pitch: number;
  /** Extra glyph churn from how fast the globe is turning, rad/s. */
  churnRate?: number;
  reduced: boolean;
};

export type GlobeJourneyFrame = GlobeFrame & {
  /** Scroll-scrubbed transformation, 0 = globe and 1 = inside the screen. */
  progress: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
};

const STREAMS = 32;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / Math.max(to - from, 0.001));
  return t * t * (3 - 2 * t);
};

/** Starts on the first page scroll and completes when the real screen reaches
 * the upper quarter. */
export function globeJourneyProgress(
  scrollTop: number,
  screenTop: number,
  viewportHeight: number,
) {
  if (!(viewportHeight > 0)) return 0;
  if (scrollTop <= 0) return 0;
  const distance = screenTop + scrollTop - viewportHeight * 0.24;
  return clamp01(scrollTop / Math.max(distance, 1));
}

/** Softens discrete wheel/touchpad steps without changing scroll endpoints. */
export function smoothGlobeJourneyProgress(current: number, target: number, dt: number) {
  const next = clamp01(current) +
    (clamp01(target) - clamp01(current)) * (1 - Math.exp(-Math.max(0, dt) / 0.12));
  return Math.abs(target - next) < 0.0005 ? clamp01(target) : next;
}

/** Holds the glyph topology steady while the globe stretches into streams. */
export function globeJourneyClockRate(progress: number) {
  return 1 - smoothstep(0, 0.18, progress);
}

/** Lets the lower edge unravel before the globe itself starts travelling. */
export function globeJourneyTravel(progress: number) {
  return easeInOutQuad(smoothstep(0.15, 1, progress));
}

/** Crossfades the light globe glyphs to ink as the dark backing dissolves. */
export function globeJourneyInk(progress: number) {
  return smoothstep(0, 0.1, progress);
}

/** A second scroll interval in the FAQ-to-footer bridge. */
export function cleanGlobeJourneyProgress(
  dockTop: number,
  viewportHeight: number,
) {
  if (!(viewportHeight > 0)) return 0;
  return 1 - smoothstep(-0.35, 0.95, dockTop / viewportHeight);
}

export function cleanGlobeJourneyOpacity(progress: number) {
  return smoothstep(0, 0.18, progress);
}

export function cleanGlobeJourneyTravel(progress: number) {
  return easeInOutQuad(smoothstep(0.05, 0.92, progress));
}

/** The globe sits on the painted sun at full size — the blur is behind it,
 *  so growing in from a smaller disc would read as coming up from below. */
export function cleanGlobeJourneyScale(_progress: number) {
  return 1;
}

/** Kept at zero: the mesh is already in its socket, not rising from the terrace. */
export const FINALE_GLOBE_RISE = 0;

/** Distance haze over the sphere: how far the warm veil reaches past it. */
export const FINALE_HAZE_SPREAD = 1.5;

/** Out-of-focus sun behind the 3D globe: mask radius in globe diameters.
 *  The painted disc's radius is ~0.54 of the globe diameter; this stays
 *  larger so the solid blur covers the sharp limb instead of fading on it. */
export const FINALE_SUN_BLUR_RADIUS = 1.2;

/** Where the orb sits inside `finale-sky.jpg`, measured off the file: the
 *  glowing disc spans x 265..615 and y 362..700 of the 1920x1279 frame, and
 *  the foreground terrace closes over the sky at y 1105. This module walks
 *  the same `object-fit: cover` crop the browser does and hands the photo its
 *  `object-position` back, which is what keeps the 3D globe hanging exactly
 *  where the painted orb is at any window shape, instead of being parked at a
 *  percentage that only holds for one aspect ratio. */
export const FINALE_SKY = {
  aspect: 1920 / 1279,
  centerX: 441 / 1920,
  centerY: 531 / 1279,
  /** Painted orb diameter as a fraction of the frame width. */
  diameter: 344 / 1920,
  /** Where the foreground terrace closes: everything below it is painted
   *  again on top of the globe, so the sphere rises out from behind it. */
  ridge: 1105 / 1279,
  /** Feather on that cut, in frame heights, so the seam never reads as a line. */
  ridgeFade: 26 / 1279,
} as const;

/** Where in the card the orb should end up. The crop is solved for this
 *  instead of a fixed `object-position`, because the orb sits at 23% of the
 *  frame: any focus that keeps it on screen in a narrow card throws it off in
 *  a wide one. Solving pins it at the same spot in every card shape, and the
 *  focus that falls out is handed back to the `<img>` so photo and 3D globe
 *  can never disagree about where the crop landed. */
const FINALE_ANCHOR = { x: 0.42, y: 0.42 } as const;
/** The 3D sphere sits *inside* the painted orb, not over it: a rim of the
 *  photo's own fire stays visible all the way around, so the mesh reads as
 *  something hanging in that sky rather than a decal on top of it. */
const FINALE_GLOBE_OVERFILL = 0.92;

export type FinaleGlobeFit = {
  x: number;
  y: number;
  diameter: number;
  /** Terrace cut and its feather, in px down from the floor's top edge. */
  ridge: number;
  ridgeFade: number;
  /** `object-position` the photo must use for this crop, as fractions. */
  focusX: number;
  focusY: number;
};

/** The rectangle `object-fit: cover` paints the sky into, inside `floor`,
 *  slid so the orb lands on `FINALE_ANCHOR` — and how far the slide is, as
 *  the `object-position` fraction that produces it. */
function finaleSkyCrop(floor: { width: number; height: number }) {
  const wide = floor.width / floor.height > FINALE_SKY.aspect;
  const width = wide ? floor.width : floor.height * FINALE_SKY.aspect;
  const height = wide ? floor.width / FINALE_SKY.aspect : floor.height;
  // Never past an edge: the crop may only slide within the overflow it has.
  const slide = (box: number, drawn: number, want: number) =>
    Math.max(box - drawn, Math.min(0, want));
  const left = slide(
    floor.width,
    width,
    floor.width * FINALE_ANCHOR.x - width * FINALE_SKY.centerX,
  );
  const top = slide(
    floor.height,
    height,
    floor.height * FINALE_ANCHOR.y - height * FINALE_SKY.centerY,
  );
  const focus = (box: number, drawn: number, offset: number) =>
    drawn > box ? offset / (box - drawn) : 0.5;
  return {
    width,
    height,
    left,
    top,
    focusX: focus(floor.width, width, left),
    focusY: focus(floor.height, height, top),
  };
}

/** Places the 3D globe on the painted orb, in `origin`'s coordinate space. */
export function finaleGlobeFit(
  floor: { left: number; top: number; width: number; height: number },
  origin: { left: number; top: number },
): FinaleGlobeFit {
  if (!(floor.width > 0 && floor.height > 0)) {
    return { x: 0, y: 0, diameter: 0, ridge: 0, ridgeFade: 0, focusX: 0.5, focusY: 0.5 };
  }
  const crop = finaleSkyCrop(floor);
  return {
    x: floor.left + crop.left + crop.width * FINALE_SKY.centerX - origin.left,
    y: floor.top + crop.top + crop.height * FINALE_SKY.centerY - origin.top,
    diameter: crop.width * FINALE_SKY.diameter * FINALE_GLOBE_OVERFILL,
    ridge: crop.top + crop.height * FINALE_SKY.ridge,
    ridgeFade: crop.height * FINALE_SKY.ridgeFade,
    focusX: crop.focusX,
    focusY: crop.focusY,
  };
}

/** Clip `rect` to `box` (both in the same coordinate space). */
export function clipRectToViewport(
  rect: { top: number; right: number; bottom: number; left: number },
  box: { top: number; right: number; bottom: number; left: number },
  radius: number,
) {
  const top = Math.max(0, rect.top - box.top);
  const right = Math.max(0, box.right - rect.right);
  const bottom = Math.max(0, box.bottom - rect.bottom);
  const left = Math.max(0, rect.left - box.left);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

/** Writes one frame's quads into `out` and returns how many were written.
 *  `glyphsOut`, when given, receives the character drawn by each quad — the
 *  only way to assert on how the field churns. */
export function layoutGlobe(f: GlobeFrame, out: Float32Array, glyphsOut?: string[]): number {
  const slice = f.reduced ? 1 : easeInOutQuad(f.t / INTRO_S);
  const paneW = f.width ?? f.size;
  const paneH = f.height ?? f.size;
  const cx = paneW / 2;
  const cy = paneH / 2;
  const R = (f.size / 2) * SPHERE_FILL;
  const spin = f.reduced ? 0 : f.t * UV_SPEED;
  const phase = f.reduced ? 0.5 / RINGS : f.t * SHAPE_SPEED;
  const bandOffset = spin + (f.yaw + f.pitch) * HIGHLIGHT_LEAN;
  const density = Math.min(DENSITY_MAX, f.size / COLS_REF_PX);
  const reduced = f.reduced;
  const churn = reduced ? 0 : SPIN_RATE * Math.abs(f.churnRate ?? 0);

  const cosT = Math.cos(TILT);
  const sinT = Math.sin(TILT);
  const cosP = Math.cos(f.pitch);
  const sinP = Math.sin(f.pitch);

  const ringParams = { ...RING_LOOK, slice };

  let n = 0;
  if (glyphsOut) glyphsOut.length = 0;

  for (let i = 0; i < RINGS; i++) {
    const ring = ringAt(i, phase, ringParams);
    if (ring.opacity <= 0.001) continue;
    const ry = (ring.t * 2 - 1) * R;
    const rr = ring.radius * R;
    const cols = Math.max(8, Math.round(COLS_EQ * ring.radius * density));

    for (let c = 0; c < cols; c++) {
      // u: where the cell sits around the ring, 0..1 — the coordinate the
      // highlight bands and the glyph churn are both keyed on.
      const u = c / cols;
      const a = (u + ring.rot / (Math.PI * 2) + spin) * Math.PI * 2 + f.yaw;

      // Ring point, then tilt (pitch from the cursor, fixed lean on z).
      let x = Math.cos(a) * rr;
      const z0 = Math.sin(a) * rr;
      let y = ry;
      const z = z0 * cosP - y * sinP;
      y = z0 * sinP + y * cosP;
      const xr = x * cosT - y * sinT;
      y = x * sinT + y * cosT;
      x = xr;

      // Perspective: nearer cells sit wider apart and read larger.
      const persp = CAM_Z / (CAM_Z - z / R);
      const sx = cx + x * persp;
      const sy = cy + y * persp;
      const depth = (z / R + 1) / 2; // 0 back, 1 front

      const seed = hash2(i, c);
      const band = Math.max(
        highlightAt(u + bandOffset, HL_POS, HL_SIZE, HL_EDGE),
        highlightAt(u + bandOffset, HL2_POS, HL2_SIZE, HL2_EDGE) * 0.8,
      );
      const heat = Math.min(1, band * 0.12);

      const seen = BACK_ALPHA + (1 - BACK_ALPHA) * depth;
      const rest = ring.opacity * seen * REST_ALPHA;
      const alpha = rest + (ring.opacity * PEAK_ALPHA - rest) * heat;
      if (alpha < CULL_ALPHA) continue;

      // Fractional phase: an integer offset would leave every cell crossing
      // its floor() boundary on the same tick — one strobe, not churn.
      const phaseOffset = (seed % 1024) / 1024;
      const step = Math.floor(f.t * (AMBIENT_RATE + churn) + phaseOffset);
      const glyph = glyphAt(i, c, step);
      const tile = CHAR_INDEX.get(glyph);
      if (tile === undefined) continue;

      const ink = INK[toneAt(i, c, step)];
      const lift = heat * 0.55;
      const o = n * INSTANCE_FLOATS;
      out[o] = sx;
      out[o + 1] = sy;
      out[o + 2] = FONT_PX * persp;
      out[o + 3] = tile;
      out[o + 4] = ink[0] + (1 - ink[0]) * lift;
      out[o + 5] = ink[1] + (1 - ink[1]) * lift;
      out[o + 6] = ink[2] + (1 - ink[2]) * lift;
      out[o + 7] = alpha;
      n++;
      if (glyphsOut) glyphsOut.push(glyph);
      if (n >= MAX_INSTANCES) return n;
    }
  }
  return n;
}

/** Reuses every hero-globe quad and scroll-morphs the whole sphere into a
 * flowing curtain of character streams. Nothing is sampled or dropped. */
export function layoutGlobeJourney(f: GlobeJourneyFrame, out: Float32Array): number {
  const p = clamp01(f.progress);
  const converge = smoothstep(0.22, 0.55, p);
  const narrow = smoothstep(0.1, 0.88, p);
  const ink = globeJourneyInk(p);
  const vanish = 1 - smoothstep(0.9, 1, p);
  const paneW = f.width ?? f.size;
  const paneH = f.height ?? f.size;
  const sourceX = paneW / 2;
  const sourceY = paneH / 2;
  const n = layoutGlobe(f, out);
  const rows = Math.max(2, Math.ceil(n / STREAMS));

  const travel = globeJourneyTravel(p);
  const centerX = mix(f.startX, f.targetX, travel);
  const centerY = mix(f.startY, f.targetY, travel);
  const startSpread = Math.min(paneW * 0.42, 520);

  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    const x = out[o] - sourceX;
    const y = out[o + 1] - sourceY;
    const lane = i % STREAMS;
    const row = Math.floor(i / STREAMS);
    const laneT = lane / (STREAMS - 1) - 0.5;
    const rowT = Math.min(1, row / (rows - 1));
    const laneConverge = rowT * rowT;
    const streamSpread = mix(startSpread, 18, laneConverge);
    const laneRoom = 1 - Math.abs(laneT) * 2;
    const streamX =
      f.targetX +
      laneT * streamSpread +
      Math.sin(rowT * Math.PI * 3 + lane * 0.8) *
        Math.min(22, streamSpread * 0.1) * laneRoom;
    const sourcePointY = centerY + y;
    const streamY = Math.max(sourcePointY, mix(centerY, f.targetY, rowT));

    const bottomness = clamp01(0.5 + y / (f.size * SPHERE_FILL));
    const seed = (hash2(i, lane) % 1000) / 1000;
    const releaseAt = clamp01((1 - bottomness) * 0.55 + (seed - 0.5) * 0.05);
    const release = smoothstep(releaseAt, releaseAt + 0.12, p);
    const wind =
      Math.sin(seed * Math.PI * 2 + p * Math.PI * 4) *
      Math.min(28, f.size * 0.045) *
      release;
    const flowX = centerX + x + wind;
    const flowY = mix(
      sourcePointY,
      Math.max(sourcePointY, f.targetY),
      release * 0.55,
    );
    const streamBlend = release * converge;

    const rawX = mix(flowX, streamX, streamBlend);
    const anchorX = mix(centerX, f.targetX, streamBlend);
    const dx = rawX - anchorX;
    const taper = 1 - (1 - narrow) * (1 - rowT * streamBlend);
    const halfWidth = Math.abs(dx) <= 9
      ? Math.abs(dx)
      : 9 + (Math.abs(dx) - 9) * (1 - taper);
    out[o] = anchorX + Math.sign(dx) * halfWidth;
    out[o + 1] = mix(flowY, streamY, streamBlend);
    out[o + 2] = mix(out[o + 2], 12, release);
    // The hero globe is light on charcoal; the streams become ink on paper.
    const paper = Math.max(release, ink);
    out[o + 4] = mix(out[o + 4], 0.18, paper);
    out[o + 5] = mix(out[o + 5], 0.18, paper);
    out[o + 6] = mix(out[o + 6], 0.22, paper);
    out[o + 7] *= vanish;
  }

  return n;
}
