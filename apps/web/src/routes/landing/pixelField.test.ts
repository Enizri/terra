import assert from "node:assert/strict";
import test from "node:test";
import {
  colorForHeat,
  decayHeat,
  FIELD_LILAC,
  FIELD_ORANGE,
  fieldIndex,
  fieldSize,
  stampHeat,
  depositHeat,
  stampSparks,
  stampStar,
  starCells,
  TRAIL_PALETTE,
  colorForTrail,
  isNightStar,
  nightStarColor,
} from "./pixelField.ts";

test("fieldSize covers the viewport in whole cells", () => {
  const size = fieldSize(1400, 900, 14);
  assert.equal(size.cols, 100);
  assert.equal(size.rows, 65);
});

test("stampHeat lights the cell under the pointer", () => {
  const size = { cols: 10, rows: 10 };
  const heat = new Float32Array(100);
  stampHeat(heat, size, 70, 70, 2, 1, 14);
  assert.ok(heat[fieldIndex(5, 5, 10)] > 0.5);
  assert.equal(heat[fieldIndex(0, 0, 10)], 0);
});

test("stampStar paints a pointed star and leaves the corners empty", () => {
  const size = { cols: 24, rows: 24 };
  const heat = new Float32Array(576);
  stampStar(heat, size, 168, 168, 1, 1, 14);
  assert.ok(heat[fieldIndex(12, 12, 24)] > 0.2);
  assert.equal(heat[fieldIndex(0, 0, 24)], 0);
  const cells = starCells();
  assert.ok(cells.some((c) => c.dy <= -1 && Math.abs(c.dx) <= 1), "sharp tip");
  const tipWidth = cells.filter((c) => c.dy === Math.min(...cells.map((c) => c.dy))).length;
  const midWidth = cells.filter((c) => c.dy === 0).length;
  assert.ok(tipWidth < midWidth, "tips are narrower than the middle");
});

test("depositHeat clusters cells around the pointer", () => {
  const size = { cols: 20, rows: 20 };
  const heat = new Float32Array(400);
  const lit = depositHeat(heat, size, 140, 140, 0.8, 3, 14);
  assert.ok(lit > 8);
  assert.ok(heat[fieldIndex(10, 10, 20)] > 0.4);
  assert.equal(heat[fieldIndex(0, 0, 20)], 0);
});

test("stampSparks leaves a scattered colorful patch", () => {
  const size = { cols: 20, rows: 20 };
  const trail = new Float32Array(400);
  const hues = new Float32Array(400);
  const lit = stampSparks(trail, hues, size, 140, 140, 3.2, 0.5, 14);
  assert.ok(lit > 3);
  assert.equal(colorForTrail(1, 0).r, FIELD_ORANGE.r);
  assert.ok(TRAIL_PALETTE.length >= 4);
});

test("decayHeat cools the field and eventually clears it", () => {
  const heat = new Float32Array([0.9, 0.004, 0]);
  const live = decayHeat(heat, 0.5);
  assert.ok(heat[0] < 0.9);
  assert.equal(heat[1], 0);
  assert.equal(live, 1);
});

test("the night sky is mostly dark with a scatter of stars", () => {
  let stars = 0;
  for (let row = 0; row < 40; row += 1) {
    for (let col = 0; col < 60; col += 1) {
      if (isNightStar(col, row)) stars += 1;
    }
  }
  assert.ok(stars > 40 && stars < 400, `sparse stars, got ${stars}`);
  const a = nightStarColor(4, 9, 0).a;
  const b = nightStarColor(4, 9, 1.2).a;
  assert.ok(Math.abs(a - b) > 0.02, "stars twinkle");
});

test("colorForHeat is the orange–lilac wash", () => {
  const low = colorForHeat(0);
  const high = colorForHeat(1);
  assert.equal(low.r, FIELD_LILAC.r);
  assert.equal(high.r, FIELD_ORANGE.r);
  assert.ok(high.a > low.a);
});
