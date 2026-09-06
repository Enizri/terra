/** Codex Computer Use pointer: taupe fill, light rim, tip at (0, 0).
 *  Contour is the recovered software-cursor glyph (21px body). */
const CONTOUR: readonly { y: number; minX: number; maxX: number }[] = [
  { y: 39, minX: 17, maxX: 21 },
  { y: 38, minX: 16, maxX: 22 },
  { y: 37, minX: 15, maxX: 22 },
  { y: 36, minX: 15, maxX: 23 },
  { y: 35, minX: 15, maxX: 24 },
  { y: 34, minX: 15, maxX: 24 },
  { y: 33, minX: 14, maxX: 25 },
  { y: 32, minX: 14, maxX: 25 },
  { y: 31, minX: 14, maxX: 26 },
  { y: 30, minX: 14, maxX: 27 },
  { y: 29, minX: 13, maxX: 29 },
  { y: 28, minX: 13, maxX: 31 },
  { y: 27, minX: 13, maxX: 34 },
  { y: 26, minX: 13, maxX: 36 },
  { y: 25, minX: 13, maxX: 37 },
  { y: 24, minX: 12, maxX: 37 },
  { y: 23, minX: 12, maxX: 37 },
  { y: 22, minX: 12, maxX: 37 },
  { y: 21, minX: 12, maxX: 37 },
  { y: 20, minX: 12, maxX: 36 },
  { y: 19, minX: 11, maxX: 36 },
  { y: 18, minX: 11, maxX: 34 },
  { y: 17, minX: 11, maxX: 32 },
  { y: 16, minX: 11, maxX: 30 },
  { y: 15, minX: 10, maxX: 27 },
  { y: 14, minX: 10, maxX: 25 },
  { y: 13, minX: 10, maxX: 23 },
  { y: 12, minX: 11, maxX: 21 },
  { y: 11, minX: 11, maxX: 19 },
  { y: 10, minX: 13, maxX: 16 },
];

const TIP_X = (CONTOUR[0].minX + CONTOUR[0].maxX) / 2;
const TIP_Y = CONTOUR[0].y;
const SOURCE_SCALE = 21 / 29;

export const POINTER_FILL = "rgba(97,92,89,0.98)";
export const POINTER_STROKE = "rgba(230,230,230,0.92)";
/** Fixed tilt so the tip aims up-left, then flipped 180° and nudged left. */
export const POINTER_REST = -0.55 + Math.PI - 0.55;

function mapPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - TIP_X) * SOURCE_SCALE,
    y: (TIP_Y - y) * SOURCE_SCALE,
  };
}

export const ARROW_PATH: readonly { x: number; y: number }[] = [
  ...CONTOUR.map((row) => mapPoint(row.minX, row.y)),
  ...[...CONTOUR].reverse().map((row) => mapPoint(row.maxX, row.y)),
];

function traceArrow(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(ARROW_PATH[0].x, ARROW_PATH[0].y);
  for (let i = 1; i < ARROW_PATH.length; i += 1) {
    ctx.lineTo(ARROW_PATH[i].x, ARROW_PATH[i].y);
  }
  ctx.closePath();
}

function paintGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  rotation: number,
  halo: boolean,
  trace: (ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (halo) {
    trace(ctx);
    ctx.strokeStyle = "rgb(245,245,245)";
    ctx.lineWidth = 5.5;
    ctx.stroke();
    ctx.fillStyle = "rgb(245,245,245)";
    ctx.fill();
  }
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 0.6;
  trace(ctx);
  ctx.fillStyle = POINTER_FILL;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = POINTER_STROKE;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.restore();
}

export function paintPointerArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale = 1,
  rotation = POINTER_REST,
  halo = true,
): void {
  paintGlyph(ctx, x, y, scale, rotation, halo, traceArrow);
}

/** Room around the glyph for the halo stroke, the rim and the drop shadow. */
const SPRITE_PAD = 8;

/** Rotated glyph bounds in CSS px relative to the tip, padded for the halo,
 *  rim and shadow. Sizes the offscreen sprite. */
export function pointerSpriteBox(scale = 1, rotation = POINTER_REST) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ARROW_PATH) {
    const x = (p.x * cos - p.y * sin) * scale;
    const y = (p.x * sin + p.y * cos) * scale;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = SPRITE_PAD * Math.max(1, scale);
  // Whole pixels: a sprite with a fractional hotspot lands off the pixel grid
  // and resamples, which shows up as a softer rim than the traced glyph had.
  return {
    minX: Math.floor(minX - pad),
    minY: Math.floor(minY - pad),
    maxX: Math.ceil(maxX + pad),
    maxY: Math.ceil(maxY + pad),
  };
}

export type PointerSprite = {
  canvas: HTMLCanvasElement;
  /** Where the tip sits inside the sprite, in CSS px. */
  hotX: number;
  hotY: number;
  width: number;
  height: number;
};

/** Bake the glyph once at the device ratio. Re-tracing a shadowed, stroked
 *  path every frame is the most expensive thing a cursor can do; blitting the
 *  same bitmap is not. Re-bake when the ratio changes, not per frame. */
export function createPointerSprite(
  dpr = 1,
  scale = 1,
  rotation = POINTER_REST,
  halo = true,
): PointerSprite | null {
  const box = pointerSpriteBox(scale, rotation);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * dpr));
  canvas.height = Math.max(1, Math.ceil(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintPointerArrow(ctx, -box.minX, -box.minY, scale, rotation, halo);
  return { canvas, hotX: -box.minX, hotY: -box.minY, width, height };
}

/** Anything you can press — native hand, not the custom glyph. `[data-sel]`
 *  covers the replica elements you pick inside the Ask Terra card, which are
 *  plain boxes with a click handler rather than buttons. */
export const CLICKABLE =
  "button,summary,label[for],select,a[href],a.sh-btn,[data-sel],.rp-btn," +
  "[role='button'],[role='link'],[role='tab'],[role='menuitem'],[role='option']," +
  "[role='checkbox'],[role='radio'],[role='switch']," +
  "input[type='button'],input[type='submit'],input[type='reset']," +
  "input[type='checkbox'],input[type='radio'],input[type='file'],input[type='color']";

/** Text entry — native caret, so the glyph never sits on top of one. */
export const TEXT_FIELD =
  "textarea,[contenteditable=''],[contenteditable='true']," +
  "input:not([type='button'],[type='submit'],[type='reset'],[type='checkbox']," +
  "[type='radio'],[type='file'],[type='color'],[type='range'])";

function inert(el: Element): boolean {
  return el.matches(":disabled") || el.getAttribute("aria-disabled") === "true";
}

export function isClickableElement(el: Element | null): boolean {
  const hit = el?.closest(CLICKABLE);
  return Boolean(hit) && !inert(hit as Element);
}

export type NativeCursor = "pointer" | "text";

/** Which native cursor to hand back to the OS here and, just as importantly,
 *  the element to hang it on — the override is scoped to that subtree so
 *  crossing a link does not restyle the whole document. `null` keeps the
 *  custom glyph. Clickable wins over text: a checkbox inside a label is a
 *  press target, not a field. */
export function nativeCursorTarget(
  el: Element | null,
): { target: Element; kind: NativeCursor } | null {
  if (!el) return null;
  const press = el.closest(CLICKABLE);
  if (press && !inert(press)) return { target: press, kind: "pointer" };
  const field = el.closest(TEXT_FIELD);
  if (field && !inert(field)) return { target: field, kind: "text" };
  return null;
}
