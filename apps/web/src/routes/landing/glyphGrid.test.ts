import assert from "node:assert/strict";
import test from "node:test";
import {
  GLYPHS,
  hash2,
  easeInOutQuad,
  glyphAt,
  highlightAt,
  hoverWeight,
  resolves,
  ringAt,
  textAt,
  toneAt,
  TONE_COUNT,
} from "./glyphGrid.ts";

test("glyphAt is deterministic per cell and churns with step", () => {
  assert.equal(glyphAt(3, 7, 0), glyphAt(3, 7, 0));
  assert.ok(GLYPHS.includes(glyphAt(-4, 91, 12)));
  const steps = new Set(Array.from({ length: 40 }, (_, s) => glyphAt(3, 7, s)));
  assert.ok(steps.size > 5, "glyph should change as step advances");
});

test("toneAt walks dim mid and white as the cell churns", () => {
  assert.equal(toneAt(3, 7, 0), toneAt(3, 7, 0));
  const tones = new Set(Array.from({ length: 40 }, (_, s) => toneAt(3, 7, s)));
  assert.equal(tones.size, TONE_COUNT);
});

test("the scramble pool is code syntax, not a random alphabet", () => {
  assert.equal(/\s/.test(GLYPHS), false, "spaces are reserved for the lens");
  assert.ok(GLYPHS.includes("useState"));
  assert.ok(GLYPHS.includes("Handle"));
  assert.ok(GLYPHS.includes("{") && GLYPHS.includes("("));
});

test("hoverWeight falls from 1 at the cursor to 0 at the radius", () => {
  assert.equal(hoverWeight(0, 100), 1);
  assert.equal(hoverWeight(100, 100), 0);
  assert.equal(hoverWeight(180, 100), 0);
  assert.equal(hoverWeight(50, 0), 0);
  assert.ok(hoverWeight(20, 100) > hoverWeight(60, 100));
});

test("easeInOutQuad is pinned at both ends and symmetric", () => {
  assert.equal(easeInOutQuad(0), 0);
  assert.equal(easeInOutQuad(1), 1);
  assert.equal(easeInOutQuad(0.5), 0.5);
  assert.ok(Math.abs(easeInOutQuad(0.25) + easeInOutQuad(0.75) - 1) < 1e-12);
});

const RP = { count: 13, slice: 1, spherify: 1, twist: Math.PI, fadeSize: 0.3, fadeSmooth: 0.25 };

test("slice 0 collapses the stack, slice 1 spreads it into a sphere", () => {
  const flat = Array.from({ length: 13 }, (_, i) => ringAt(i, 0, { ...RP, slice: 0 }));
  assert.ok(flat.every((r) => r.t === 0));
  const open = Array.from({ length: 13 }, (_, i) => ringAt(i, 0, RP));
  const widest = open.reduce((a, b) => (b.radius > a.radius ? b : a));
  assert.ok(widest.t > 0.4 && widest.t < 0.6, "widest ring sits at the equator");
  assert.ok(open.every((r) => r.radius <= 1 + 1e-9 && r.radius >= 0));
});

test("rings fade in at the bottom and out at the top", () => {
  assert.equal(ringAt(0, 0, RP).opacity, 0);
  assert.ok(ringAt(0, 0.5, RP).opacity > 0.9);
  assert.equal(ringAt(0, 0.999, RP).opacity, 0);
});

test("highlight peaks on the band and dies outside it", () => {
  assert.equal(highlightAt(0.35, 0.35, 0.18, 0.16), 1);
  assert.equal(highlightAt(0.85, 0.35, 0.18, 0.16), 0);
  // Wraps around the ring seam.
  assert.ok(highlightAt(0.99, 0.01, 0.18, 0.16) > 0.9);
});

test("the lens resolves cells near the cursor, with a ragged edge", () => {
  const seeds = Array.from({ length: 200 }, (_, i) => hash2(i, i * 3));
  const resolvedAtCore = seeds.filter((s) => resolves(1, s, 0.35, 0.4)).length;
  const resolvedAtRim = seeds.filter((s) => resolves(0.5, s, 0.35, 0.4)).length;
  const resolvedOutside = seeds.filter((s) => resolves(0.05, s, 0.35, 0.4)).length;
  assert.equal(resolvedAtCore, seeds.length, "core is fully readable");
  assert.equal(resolvedOutside, 0, "nothing resolves away from the cursor");
  assert.ok(resolvedAtRim > 0 && resolvedAtRim < seeds.length, "rim is mixed");
});

test("textAt wraps in both directions", () => {
  assert.equal(textAt("abc", 0), "a");
  assert.equal(textAt("abc", 4), "b");
  assert.equal(textAt("abc", -1), "c");
});
