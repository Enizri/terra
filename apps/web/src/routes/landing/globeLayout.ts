import {
  CHAR_INDEX,
  easeInOutQuad,
  glyphAt,
  hash2,
  highlightAt,
  hoverWeight,
  resolves,
  ringAt,
  textAt,
  toneAt,
} from "./glyphGrid.ts";
import { copy } from "./data.ts";

/* Geometry: a stack of rings that drift upward
   and wrap, scaled to a sphere silhouette, twisted along the stack, with two
   highlight bands sweeping the surface. Ours draws characters instead of a
   mapped text texture, and the cursor works as a decoder lens — glyphs are
   scrambled until it lands on them.

   This module is pure: it turns a moment in time into a flat buffer of quad
   instances. Nothing here touches the DOM or a GL context, so the whole look
   is testable without a GPU. */

/** Rings in the stack, and cells around the widest ring. Narrow rings get
 *  proportionally fewer cells so the glyph density stays even instead of
 *  caking up at the poles. */
export const RINGS = 36;
export const COLS_EQ = 156;
/** Box width the cell count is tuned for; smaller globes thin out with it. */
const COLS_REF_PX = 560;
/** How far the sentence advances from one ring to the next. A prime keeps
 *  rings from lining up into vertical stripes of the same word. */
const TEXT_ROW_STEP = 37;
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
/** How far the highlight bands slide with the cursor, in turns. */
const HIGHLIGHT_LEAN = 0.06;
/** Camera distance in sphere radii — drives the perspective spread. */
const CAM_Z = 4;
/** Sphere size inside its box. */
const SPHERE_FILL = 0.96;
/** Highlight bands: centre, width and edge softness, in turns. */
const HL_POS = 0.35;
const HL_SIZE = 0.18;
const HL_EDGE = 0.16;
const HL2_POS = 0.72;
const HL2_SIZE = 0.42;
const HL2_EDGE = 0.15;
/** Glyph flips per second with the pointer away / right under it. */
const AMBIENT_RATE = 0.5;
const HOVER_RATE = 24;
/** Lens radius, as a share of the globe radius. Wide enough that whole words
 *  land inside it — a small lens resolves single letters and reads as noise. */
const HOVER_R = 0.58;
/** Lens strength needed to resolve a cell, and the per-cell jitter on it. */
const RESOLVE_MIN = 0.12;
const RESOLVE_JITTER = 0.4;
/** Monospace cell size at the sphere's equator. */
const FONT_PX = 9;
/** Solid enough to read, not a wash. */
const REST_ALPHA = 1;
const PEAK_ALPHA = 1;
/** How far the back of the globe fades behind the front. */
const BACK_ALPHA = 0.5;
/** Inside the lens the depth fade lifts, so the far side shows through. */
const LENS_SEE_THROUGH = 0.92;
/** How hard the lens punches out the front face (their hover × 2.5 dissolve). */
const HOLE_GAIN = 2.4;
/** Discrete inks — true black, a darker gray, and white. Spread so all three
 *  read on the gray-pastel floor. */
const INK = [
  [0, 0, 0],
  [0.3, 0.3, 0.29],
  [1, 1, 1],
] as const;
/** Below this a cell is invisible; drawing it is pure cost. */
const CULL_ALPHA = 0.035;

/** Floats per quad instance: x, y, size, tile, r, g, b, a. */
export const INSTANCE_FLOATS = 8;

/** Worst-case instance count, for sizing the buffer once. */
export const MAX_INSTANCES = RINGS * COLS_EQ * 3;

export type GlobeFrame = {
  /** Canvas box side in CSS px. */
  size: number;
  /** Seconds since the globe mounted. */
  t: number;
  /** Cursor in canvas px; far away when the pointer has left. */
  pointerX: number;
  pointerY: number;
  /** Smoothed mouse-look, radians. */
  yaw: number;
  pitch: number;
  reduced: boolean;
};

/** Writes one frame's quads into `out` and returns how many were written.
 *  `glyphsOut`, when given, receives the character drawn by each quad — the
 *  only way to assert on what the lens actually decoded. */
export function layoutGlobe(f: GlobeFrame, out: Float32Array, glyphsOut?: string[]): number {
  const text = copy.heroGlobeText;
  const slice = f.reduced ? 1 : easeInOutQuad(f.t / INTRO_S);
  const cx = f.size / 2;
  const cy = f.size / 2;
  const R = (f.size / 2) * SPHERE_FILL;
  const spin = f.reduced ? 0 : f.t * UV_SPEED;
  const phase = f.reduced ? 0.5 / RINGS : f.t * SHAPE_SPEED;
  const bandOffset = spin + (f.yaw + f.pitch) * HIGHLIGHT_LEAN;
  const hoverR = R * HOVER_R;
  const density = Math.min(1, f.size / COLS_REF_PX);
  const px = f.pointerX;
  const py = f.pointerY;
  const reduced = f.reduced;

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
    // Each ring picks up the sentence where the one below it left off.
    const textStart = i * TEXT_ROW_STEP;

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
      const dx = sx - px;
      const dy = sy - py;
      const weight = reduced ? 0 : hoverWeight(Math.sqrt(dx * dx + dy * dy), hoverR);
      const band = Math.max(
        highlightAt(u + bandOffset, HL_POS, HL_SIZE, HL_EDGE),
        highlightAt(u + bandOffset, HL2_POS, HL2_SIZE, HL2_EDGE) * 0.8,
      );
      const heat = Math.min(1, band * 0.12 + weight * 1.85);

      // Depth fade lifts under the lens so the far side shows through, while
      // the near face stipple-dissolves — their hollow spotlight.
      const hole = Math.min(1, weight * HOLE_GAIN);
      const stipple = ((seed >>> 7) % 1000) / 1000;
      const dissolve = hole > 0.12 + stipple * 0.5 ? hole : hole * 0.15;
      const fade = BACK_ALPHA + (1 - BACK_ALPHA) * depth;
      const seen = fade + (1 - fade) * (weight * LENS_SEE_THROUGH);
      const punched = 1 - dissolve * Math.max(0, depth * 1.15 - 0.15);
      const rest = ring.opacity * seen * REST_ALPHA * punched;
      const alpha = rest + (ring.opacity * PEAK_ALPHA * punched - rest) * heat;
      if (alpha < CULL_ALPHA) continue;

      // Fractional phase: an integer offset would leave every cell crossing
      // its floor() boundary on the same tick — one strobe, not churn.
      const churn = (seed % 1024) / 1024;
      const step = Math.floor(f.t * (AMBIENT_RATE + HOVER_RATE * weight) + churn);
      // Away from the cursor the field is scrambled; the lens decodes it.
      const glyph = resolves(weight, seed, RESOLVE_MIN, RESOLVE_JITTER)
        ? textAt(text, textStart + c)
        : glyphAt(i, c, step);
      const tile = CHAR_INDEX.get(glyph);
      if (tile === undefined) continue;

      const ink = INK[toneAt(i, c, step)];
      const o = n * INSTANCE_FLOATS;
      out[o] = sx;
      out[o + 1] = sy;
      out[o + 2] = FONT_PX * persp;
      out[o + 3] = tile;
      out[o + 4] = ink[0];
      out[o + 5] = ink[1];
      out[o + 6] = ink[2];
      out[o + 7] = alpha;
      n++;
      if (glyphsOut) glyphsOut.push(glyph);
      if (n >= MAX_INSTANCES) return n;
    }
  }
  return n;
}
