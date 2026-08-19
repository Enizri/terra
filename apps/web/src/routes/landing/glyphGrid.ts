import { copy } from "./data.ts";
/** Pure helpers behind the hero glyph circle. Kept out of the component so the
 *  churn and hover falloff are testable without a canvas. */

/** Scramble pool: the globe wrap with gaps stripped, so off-cursor cells
 *  still look like code (fn, {}, ::) instead of a random alphabet, without
 *  word-shaped holes that would fake the lens. */
export const GLYPHS = copy.heroGlobeText.replace(/\s+/g, "");

/** Stable 32-bit hash of a cell coordinate — same cell, same glyph, every
 *  resize. `Math.random()` per frame would shimmer the whole circle. */
export function hash2(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Glyph for a cell at churn `step` (an integer that advances over time). */
export function glyphAt(col: number, row: number, step: number) {
  return GLYPHS[hash2(col, row + step * 7919) % GLYPHS.length];
}

/** Black / gray / white — flips with the same churn as the glyph. */
export const TONE_COUNT = 3;
export function toneAt(col: number, row: number, step: number) {
  return hash2(col, row + step * 104729) % TONE_COUNT;
}

/** Pointer influence: 1 at the cursor, 0 at radius `r`, eased quadratically. */
export function hoverWeight(d: number, r: number) {
  if (!(r > 0)) return 0;
  const w = 1 - d / r;
  return w <= 0 ? 0 : w >= 1 ? 1 : w * w;
}

/** gsap's `power1.inOut`. */
export function easeInOutQuad(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

export type RingParams = {
  /** Rings drawn in the stack. */
  count: number;
  /** 0 = stack collapsed into one disc, 1 = spread over the full height. */
  slice: number;
  /** 0 = straight cylinder, 1 = sphere silhouette. */
  spherify: number;
  /** Total twist across the stack, radians. */
  twist: number;
  /** Share of the run where a ring fades in / out, and the softness of it. */
  fadeSize: number;
  fadeSmooth: number;
};

export type Ring = {
  /** 0..1 along the stack; 0.5 is the equator. */
  t: number;
  /** Ring radius as a share of the sphere radius. */
  radius: number;
  /** Own y rotation from the twist. */
  rot: number;
  opacity: number;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One ring of the stack at conveyor phase `phase` (turns, wraps at 1).
 *  Rings drift up through the stack and wrap. */
export function ringAt(i: number, phase: number, p: RingParams): Ring {
  const raw = i / p.count + phase;
  const o = raw - Math.floor(raw);
  const t = o * p.slice;
  const sphere = Math.sqrt(Math.max(0, 1 - (t * 2 - 1) ** 2));
  const fadeIn = clamp01((o - (p.fadeSize - p.fadeSmooth)) / Math.max(p.fadeSmooth, 0.001));
  const fadeOut = clamp01((1 - p.fadeSize + p.fadeSmooth - o) / Math.max(p.fadeSmooth, 0.001));
  return {
    t,
    radius: 1 + (sphere - 1) * p.spherify,
    rot: (i / p.count) * p.twist,
    opacity: Math.min(fadeIn, fadeOut),
  };
}

/** Two-band highlight, as a share 0..1 of how strongly a cell is lit.
 *  `u` is the cell's position around the ring; `pos` the band centre. */
export function highlightAt(u: number, pos: number, size: number, edge: number) {
  let d = Math.abs(u - pos);
  if (d > 0.5) d = 1 - d;
  return 1 - clamp01((d - size * 0.5) / Math.max(edge, 0.001));
}

/** Does the lens resolve this cell to its true character?
 *  The per-cell jitter keeps the boundary ragged — a clean circular cut reads
 *  as a mask, a ragged one reads as text swimming into focus. */
export function resolves(weight: number, seed: number, min: number, jitter: number) {
  return weight > min + ((seed >>> 3) % 1000) / 1000 * jitter;
}

/** Character of `text` at `i`, wrapping. Spaces are kept — the gaps between
 *  words are what makes the resolved pocket readable. */
export function textAt(text: string, i: number) {
  const n = text.length;
  return text[((i % n) + n) % n];
}

/** Every character the globe can paint: the scramble set plus whatever the
 *  resolved copy needs. Order is the atlas tile order. */
export const CHARSET = Array.from(new Set((GLYPHS + copy.heroGlobeText).split(""))).join("");
export const CHAR_INDEX = new Map(Array.from(CHARSET, (ch, i) => [ch, i] as const));
