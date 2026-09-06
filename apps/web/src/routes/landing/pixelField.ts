/** Cell pitch for the landing heat field. Snapped so a 1440×900
 *  viewport stays a few thousand cells, not a shader. */
export const FIELD_CELL = 14;

/** Compass-star occupancy — four long tips, pinched waist, same tilt as
 *  `.sh-terra-mark`. */
export const STAR_POINTS = 4;
export const STAR_OUTER = 1.45;
export const STAR_INNER = 0.4;
export const STAR_TILT_DEG = 2.5;

/** Brush radius in cells for the colorful trail. */
export const FIELD_BRUSH = 1.35;

export type StarCell = { dx: number; dy: number };

function insideStar(x: number, y: number, verts: readonly { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i, i += 1) {
    const a = verts[i];
    const b = verts[j];
    const crosses = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + b.x;
    if (crosses) hit = !hit;
  }
  return hit;
}

/** Pointed compass star (outer tips, pinched waist) — not bar spokes. */
export function starCells(
  outer = STAR_OUTER,
  inner = STAR_INNER,
  tiltDeg = STAR_TILT_DEG,
): StarCell[] {
  const tilt = (tiltDeg * Math.PI) / 180;
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < STAR_POINTS * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = tilt - Math.PI / 2 + (i * Math.PI) / STAR_POINTS;
    verts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
  }
  const seen = new Map<string, StarCell>();
  const add = (dx: number, dy: number) => {
    seen.set(`${dx},${dy}`, { dx, dy });
  };
  for (let i = 0; i < verts.length; i += 2) {
    add(Math.round(verts[i].x), Math.round(verts[i].y));
  }
  const bound = Math.ceil(outer);
  const samples = [-0.35, 0, 0.35];
  for (let dy = -bound; dy <= bound; dy += 1) {
    for (let dx = -bound; dx <= bound; dx += 1) {
      let hit = false;
      for (const ox of samples) {
        for (const oy of samples) {
          if (insideStar(dx + ox, dy + oy, verts)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) add(dx, dy);
    }
  }
  return [...seen.values()];
}

const STAR = starCells();

/** Stamp the pointed star. Heat along the stamp is the brand wash:
 *  top-left orange, bottom-right lilac. */
export function stampStar(
  heat: Float32Array,
  size: FieldSize,
  px: number,
  py: number,
  amount: number,
  scale = 1,
  cell = FIELD_CELL,
  cells: readonly StarCell[] = STAR,
): void {
  const cx = px / cell - 0.5;
  const cy = py / cell - 0.5;
  const s = Math.max(0.6, scale);
  for (const { dx, dy } of cells) {
    const col = Math.round(cx + dx * s);
    const row = Math.round(cy + dy * s);
    if (col < 0 || row < 0 || col >= size.cols || row >= size.rows) continue;
    const wash = 0.22 + (0.5 - (dx - dy) / (STAR_OUTER * 2)) * 0.7;
    const i = fieldIndex(col, row, size.cols);
    heat[i] = Math.min(1, Math.max(heat[i], wash * amount));
  }
}

/** Stable 0..1 from a cell, so the trail palette does not flicker. */
export function cellHash(col: number, row: number): number {
  return ((col * 374761393 + row * 668265263) >>> 0) / 4294967296;
}

/** Soft gaussian heat — the clustered colorful field behind the pointer. */
export function depositHeat(
  heat: Float32Array,
  size: FieldSize,
  px: number,
  py: number,
  amount: number,
  sigma = FIELD_BRUSH,
  cell = FIELD_CELL,
): number {
  const cx = px / cell - 0.5;
  const cy = py / cell - 0.5;
  const rad = Math.ceil(sigma * 2.2);
  const inv = 1 / (2 * sigma * sigma);
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(size.cols - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(size.rows - 1, Math.ceil(cy + rad));
  let lit = 0;
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const dx = col + 0.5 - cx;
      const dy = row + 0.5 - cy;
      const w = Math.exp(-(dx * dx + dy * dy) * inv);
      if (w < 0.03) continue;
      const i = fieldIndex(col, row, size.cols);
      const next = Math.min(1, heat[i] + amount * w);
      if (heat[i] === 0 && next > 0) lit += 1;
      heat[i] = next;
    }
  }
  return lit;
}

/** Scatter colorful pixels around a point — extra grit on the heat cloud. */
export function stampSparks(
  trail: Float32Array,
  hues: Float32Array,
  size: FieldSize,
  px: number,
  py: number,
  radius = 3.2,
  density = 0.38,
  cell = FIELD_CELL,
): number {
  const cx = px / cell - 0.5;
  const cy = py / cell - 0.5;
  const r = Math.max(1, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size.cols - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size.rows - 1, Math.ceil(cy + r));
  let lit = 0;
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const dx = col - cx;
      const dy = row - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const h = cellHash(col, row);
      if (h > density) continue;
      const i = fieldIndex(col, row, size.cols);
      trail[i] = Math.min(1, trail[i] + 0.55 + h * 0.4);
      hues[i] = h;
      lit += 1;
    }
  }
  return lit;
}

/** Paper / ink / brand stops used when a cell is hot. */
export const FIELD_PAPER = { r: 249, g: 249, b: 251 };
export const FIELD_ORANGE = { r: 232, g: 64, b: 13 };
export const FIELD_LILAC = { r: 208, g: 178, b: 255 };
export const FIELD_INK = { r: 46, g: 46, b: 56 };
export const FIELD_PEACH = { r: 255, g: 176, b: 112 };
export const FIELD_VIOLET = { r: 172, g: 126, b: 255 };
export const FIELD_CREAM = { r: 255, g: 238, b: 216 };
export const FIELD_ROSE = { r: 240, g: 96, b: 88 };
/** Warm stone paper — not white, not `#101116` (that hex is reserved as a
 *  regression lock in the journey tests). */
export const FIELD_NIGHT = { r: 236, g: 229, b: 214 };
export const FIELD_NIGHT_LIFT = { r: 224, g: 214, b: 196 };
export const NIGHT_STAR_DENSITY = 0.022;

export const TRAIL_PALETTE = [
  FIELD_CREAM,
  FIELD_PEACH,
  FIELD_LILAC,
  FIELD_VIOLET,
  FIELD_ORANGE,
] as const;

export const ACCENT_PALETTE = [FIELD_VIOLET, FIELD_ROSE, FIELD_CREAM] as const;

export type FieldSize = { cols: number; rows: number };

export function fieldSize(width: number, height: number, cell = FIELD_CELL): FieldSize {
  return {
    cols: Math.max(1, Math.ceil(width / cell)),
    rows: Math.max(1, Math.ceil(height / cell)),
  };
}

export function fieldIndex(col: number, row: number, cols: number): number {
  return row * cols + col;
}

/** Add a soft disc of heat around a pixel point. */
export function stampHeat(
  heat: Float32Array,
  size: FieldSize,
  px: number,
  py: number,
  radius: number,
  amount: number,
  cell = FIELD_CELL,
): void {
  const cx = px / cell - 0.5;
  const cy = py / cell - 0.5;
  const r = Math.max(1, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(size.cols - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(size.rows - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const dx = col - cx;
      const dy = row - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const falloff = 1 - d2 / r2;
      const i = fieldIndex(col, row, size.cols);
      heat[i] = Math.min(1, heat[i] + amount * falloff * falloff);
    }
  }
}

export function decayHeat(heat: Float32Array, keep = 0.88): number {
  let live = 0;
  for (let i = 0; i < heat.length; i += 1) {
    const next = heat[i] * keep;
    heat[i] = next < 0.008 ? 0 : next;
    if (heat[i] > 0) live += 1;
  }
  return live;
}

export function mixChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mixRgb(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
): { r: number; g: number; b: number } {
  return {
    r: mixChannel(a.r, b.r, t),
    g: mixChannel(a.g, b.g, t),
    b: mixChannel(a.b, b.b, t),
  };
}

/** Brand wash on the star: lilac → orange. */
export function colorForHeat(t: number): { r: number; g: number; b: number; a: number } {
  const u = Math.min(1, Math.max(0, t));
  return {
    r: mixChannel(FIELD_LILAC.r, FIELD_ORANGE.r, u),
    g: mixChannel(FIELD_LILAC.g, FIELD_ORANGE.g, u),
    b: mixChannel(FIELD_LILAC.b, FIELD_ORANGE.b, u),
    a: 0.45 + u * 0.55,
  };
}

/** Thermal bands for the trail: ink → lilac → cream → peach → orange. */
export function colorForTrail(
  heat: number,
  hue: number,
): { r: number; g: number; b: number; a: number } {
  const u = Math.min(1, Math.max(0, heat));
  if (hue > 0.84) {
    const pal = ACCENT_PALETTE[Math.floor(hue * ACCENT_PALETTE.length) % ACCENT_PALETTE.length];
    return { r: pal.r, g: pal.g, b: pal.b, a: 0.32 + u * 0.38 };
  }
  const stops = TRAIL_PALETTE.length - 1;
  const scaled = u * stops;
  const i = Math.min(stops - 1, Math.floor(scaled));
  const t = scaled - i;
  const c = mixRgb(TRAIL_PALETTE[i], TRAIL_PALETTE[i + 1], t);
  return { r: c.r, g: c.g, b: c.b, a: 0.28 + u * 0.42 };
}

export function paintField(
  ctx: CanvasRenderingContext2D,
  trail: Float32Array,
  hues: Float32Array,
  star: Float32Array,
  size: FieldSize,
  cell = FIELD_CELL,
): void {
  ctx.clearRect(0, 0, size.cols * cell, size.rows * cell);
  const gap = 1;
  for (let row = 0; row < size.rows; row += 1) {
    for (let col = 0; col < size.cols; col += 1) {
      const i = fieldIndex(col, row, size.cols);
      const t = trail[i];
      const s = star[i];
      if (t <= 0 && s <= 0) continue;
      const c = s > t * 0.55 ? colorForHeat(s) : colorForTrail(t, hues[i] || cellHash(col, row));
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(3)})`;
      ctx.fillRect(col * cell, row * cell, cell - gap, cell - gap);
    }
  }
}

export function paintLayer(
  ctx: CanvasRenderingContext2D,
  heat: Float32Array,
  size: FieldSize,
  kind: "trail" | "star",
  hues?: Float32Array,
  cell = FIELD_CELL,
): void {
  ctx.clearRect(0, 0, size.cols * cell, size.rows * cell);
  const gap = 1;
  for (let row = 0; row < size.rows; row += 1) {
    for (let col = 0; col < size.cols; col += 1) {
      const i = fieldIndex(col, row, size.cols);
      const v = heat[i];
      if (v <= 0) continue;
      const c =
        kind === "star"
          ? colorForHeat(v)
          : colorForTrail(v, hues?.[i] || cellHash(col, row));
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(3)})`;
      ctx.fillRect(col * cell, row * cell, cell - gap, cell - gap);
    }
  }
}

export function isNightStar(col: number, row: number, density = NIGHT_STAR_DENSITY): boolean {
  return cellHash(col, row) < density;
}

export function nightStarColor(
  col: number,
  row: number,
  t = 0,
): { r: number; g: number; b: number; a: number } {
  const h = cellHash(col + 3, row + 1);
  const twinkle = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(t * 2.1 + h * 31));
  const bright = cellHash(col, row) < 0.01;
  const pal = h > 0.7 ? FIELD_LILAC : h > 0.4 ? FIELD_CREAM : FIELD_PEACH;
  return {
    r: pal.r,
    g: pal.g,
    b: pal.b,
    a: (bright ? 0.28 : 0.12) * twinkle,
  };
}

/** Calm stone paper, a faint cell grid, and a few quiet specks.
 *  Call on resize, not every frame. */
export function paintBeigePaper(
  ctx: CanvasRenderingContext2D,
  size: FieldSize,
  cell = FIELD_CELL,
): void {
  const w = size.cols * cell;
  const h = size.rows * cell;
  ctx.fillStyle = `rgb(${FIELD_NIGHT.r},${FIELD_NIGHT.g},${FIELD_NIGHT.b})`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(46,46,56,0.06)";
  for (let col = 1; col < size.cols; col += 1) {
    ctx.fillRect(col * cell - 1, 0, 1, h);
  }
  for (let row = 1; row < size.rows; row += 1) {
    ctx.fillRect(0, row * cell - 1, w, 1);
  }
  const gap = 1;
  for (let row = 0; row < size.rows; row += 1) {
    for (let col = 0; col < size.cols; col += 1) {
      if (!isNightStar(col, row)) continue;
      const s = nightStarColor(col, row, 0);
      ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${s.a.toFixed(3)})`;
      ctx.fillRect(col * cell, row * cell, cell - gap, cell - gap);
    }
  }
}

/** Beige paper plus trail. Tests and one-shot paints; the live field
 *  uses `paintBeigePaper` once and `paintLayer` for motion. */
export function paintNightSky(
  ctx: CanvasRenderingContext2D,
  size: FieldSize,
  t = 0,
  trail?: Float32Array,
  hues?: Float32Array,
  cell = FIELD_CELL,
): void {
  paintBeigePaper(ctx, size, cell);
  if (!trail) return;
  void t;
  const gap = 1;
  for (let row = 0; row < size.rows; row += 1) {
    for (let col = 0; col < size.cols; col += 1) {
      const i = fieldIndex(col, row, size.cols);
      const heat = trail[i];
      if (heat <= 0) continue;
      const c = colorForTrail(heat, hues?.[i] || cellHash(col, row));
      ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a.toFixed(3)})`;
      ctx.fillRect(col * cell, row * cell, cell - gap, cell - gap);
    }
  }
}
