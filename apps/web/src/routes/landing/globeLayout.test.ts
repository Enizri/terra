// The globe's whole look is decided in globeLayout, so this is where it can be
// checked without a GPU: run a frame, read back the quads.
import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTANCE_FLOATS,
  MAX_INSTANCES,
  cleanGlobeJourneyOpacity,
  cleanGlobeJourneyProgress,
  cleanGlobeJourneyScale,
  cleanGlobeJourneyTravel,
  clipRectToViewport,
  FINALE_GLOBE_RISE,
  FINALE_SKY,
  FINALE_SUN_BLUR_RADIUS,
  finaleGlobeFit,
  globeJourneyClockRate,
  globeJourneyProgress,
  layoutGlobe,
  layoutGlobeJourney,
  smoothGlobeJourneyProgress,
  type GlobeFrame,
} from "./globeLayout.ts";

const SIZE = 560;
const buf = new Float32Array(MAX_INSTANCES * INSTANCE_FLOATS);

const frame = (over: Partial<GlobeFrame> = {}): GlobeFrame => ({
  size: SIZE,
  t: 3,
  yaw: 0,
  pitch: 0,
  reduced: false,
  ...over,
});

const xs = (n: number) => Array.from({ length: n }, (_, i) => buf[i * INSTANCE_FLOATS]);
const spread = (n: number) => Math.max(...xs(n)) - Math.min(...xs(n));

test("the intro blooms from a point into a sphere", () => {
  const collapsed = layoutGlobe(frame({ t: 0 }), buf);
  assert.ok(collapsed > 100, "the stack is drawn from the first frame");
  assert.ok(spread(collapsed) < SIZE * 0.05, "at t=0 it is still a point");

  const open = layoutGlobe(frame({ t: 2 }), buf);
  assert.ok(spread(open) > SIZE * 0.6, "by t=2s it fills its box");
});

test("every quad lands inside the box and carries a visible colour", () => {
  const n = layoutGlobe(frame(), buf);
  for (let i = 0; i < n; i++) {
    const o = i * INSTANCE_FLOATS;
    const r = Math.hypot(buf[o] - SIZE / 2, buf[o + 1] - SIZE / 2);
    assert.ok(r <= SIZE / 2, "quad inside the circle");
    assert.ok(buf[o + 2] > 0, "positive size");
    assert.ok(buf[o + 7] > 0 && buf[o + 7] <= 1, "alpha in range");
  }
});

test("the field stays dense but inside the instance budget", () => {
  const n = layoutGlobe(frame(), buf);
  assert.ok(n > 1800, `dense enough to read as a globe (got ${n})`);
  assert.ok(n <= MAX_INSTANCES, "never overruns the buffer");
});

test("a larger canvas packs more glyphs, still inside the budget", () => {
  const atTune = layoutGlobe(frame({ size: SIZE }), buf);
  const huge = layoutGlobe(frame({ size: SIZE * 2 }), buf);
  assert.ok(huge > atTune, "density scales with the pane");
  assert.ok(huge <= MAX_INSTANCES, "never overruns the buffer");
});

test("spinning the globe churns the field faster", () => {
  const parked: string[] = [];
  layoutGlobe(frame({ churnRate: 0 }), buf, parked);
  const thrown: string[] = [];
  const n = layoutGlobe(frame({ churnRate: 6 }), buf, thrown);
  assert.ok(n > 100);
  const changed = thrown.filter((g, i) => g !== parked[i]).length;
  assert.ok(changed > n * 0.3, `spin should reshuffle the field, got ${changed}/${n}`);
});

test("reduced motion still lays out a full globe, with no spin churn", () => {
  const still: string[] = [];
  const n = layoutGlobe(frame({ reduced: true, churnRate: 6 }), buf, still);
  const parked: string[] = [];
  layoutGlobe(frame({ reduced: true, churnRate: 0 }), buf, parked);
  assert.ok(n > 1800);
  assert.ok(spread(n) > SIZE * 0.6, "opens immediately, no intro to wait through");
  assert.deepEqual(still, parked, "churn is off under reduced motion");
});

test("glyphs flip between dim, mid and white", () => {
  const n = layoutGlobe(frame(), buf);
  const tones = { dim: 0, mid: 0, white: 0 };
  for (let i = 0; i < n; i++) {
    const r = buf[i * INSTANCE_FLOATS + 4];
    if (r < 0.8) tones.dim++;
    else if (r < 0.96) tones.mid++;
    else tones.white++;
  }
  assert.ok(tones.dim > 100, `dim ${tones.dim}`);
  assert.ok(tones.mid > 100, `mid ${tones.mid}`);
  assert.ok(tones.white > 100, `white ${tones.white}`);
});

test("the scroll journey keeps the globe, stretches it, then converges on the screen", () => {
  const journey = (progress: number) =>
    layoutGlobeJourney(
      {
        ...frame(),
        progress,
        startX: SIZE * 0.75,
        startY: SIZE * 0.45,
        targetX: SIZE * 0.6,
        targetY: SIZE * 0.9,
      },
      buf,
    );

  const start = journey(0);
  assert.ok(spread(start) > SIZE * 0.6, "starts as a full globe");
  const startAlpha = Array.from(
    { length: start },
    (_, i) => buf[i * INSTANCE_FLOATS + 7],
  );
  const startPositions = Array.from({ length: start }, (_, i) => ({
    x: buf[i * INSTANCE_FLOATS],
    y: buf[i * INSTANCE_FLOATS + 1],
  }));
  let previousWidth = spread(start);
  for (let progress = 0.05; progress <= 0.9; progress += 0.05) {
    const count = journey(progress);
    const width = spread(count);
    assert.ok(width <= previousWidth + 0.5, `flow widened at ${progress.toFixed(2)}`);
    for (let i = 0; i < count; i++) {
      assert.ok(
        buf[i * INSTANCE_FLOATS + 1] >= startPositions[i].y - 0.5,
        `glyph moved upward at ${progress.toFixed(2)}`,
      );
    }
    previousWidth = width;
  }

  journey(0.18);
  const moved = startPositions.map((point, i) =>
    Math.hypot(
      buf[i * INSTANCE_FLOATS] - point.x,
      buf[i * INSTANCE_FLOATS + 1] - point.y,
    )
  );
  const lower = moved.filter((_, i) => startPositions[i].y > SIZE * 0.58);
  const upper = moved.filter((_, i) => startPositions[i].y < SIZE * 0.32);
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(average(lower) > average(upper) * 3, "the bottom peels before the top");
  assert.ok(average(upper) < SIZE * 0.08, "the upper globe holds during the peel");

  const middle = journey(0.65);
  const middleHeight = Math.max(
    ...Array.from({ length: middle }, (_, i) => buf[i * INSTANCE_FLOATS + 1]),
  ) - Math.min(...Array.from({ length: middle }, (_, i) => buf[i * INSTANCE_FLOATS + 1]));
  assert.ok(middleHeight > SIZE * 0.4, "middle keeps a downward stream to the screen");
  const travelling = Array.from({ length: middle }, (_, i) => i).filter(
    (i) => buf[i * INSTANCE_FLOATS + 7] >= startAlpha[i] * 0.5,
  );
  assert.ok(
    travelling.length > middle * 0.9,
    `the whole globe should join the flow (${travelling.length}/${middle})`,
  );

  const end = journey(0.9);
  const visibleEndXs = Array.from({ length: end }, (_, i) => i)
    .filter(
      (i) =>
        buf[i * INSTANCE_FLOATS + 7] > 0.05 &&
        buf[i * INSTANCE_FLOATS + 1] > SIZE * 0.75,
    )
    .map((i) => buf[i * INSTANCE_FLOATS]);
  assert.ok(Math.max(...visibleEndXs) - Math.min(...visibleEndXs) < SIZE * 0.35);

  assert.equal(globeJourneyProgress(0, SIZE * 2, SIZE), 0);
  assert.ok(globeJourneyProgress(1, SIZE * 2, SIZE) > 0);
  assert.ok(globeJourneyProgress(SIZE / 2, SIZE * 0.6, SIZE) > 0.5);
  assert.equal(globeJourneyProgress(SIZE, SIZE * 0.24, SIZE), 1);
});

test("scroll progress eases toward both directions without changing its endpoints", () => {
  const down = smoothGlobeJourneyProgress(0, 1, 1 / 60);
  assert.ok(down > 0 && down < 1);
  assert.ok(smoothGlobeJourneyProgress(down, 0, 1 / 60) < down);
  assert.equal(smoothGlobeJourneyProgress(0, 1, 1), 1);
});

test("the character clock eases to a stop before the stream stage", () => {
  assert.equal(globeJourneyClockRate(0), 1);
  assert.ok(globeJourneyClockRate(0.09) > 0 && globeJourneyClockRate(0.09) < 1);
  assert.equal(globeJourneyClockRate(0.18), 0);
  assert.equal(globeJourneyClockRate(1), 0);
});

test("the clean globe starts only after the character journey ends", () => {
  assert.equal(cleanGlobeJourneyProgress(SIZE * 0.95, SIZE), 0);
  assert.ok(cleanGlobeJourneyProgress(SIZE * 0.06, SIZE) > 0);
  assert.equal(cleanGlobeJourneyProgress(SIZE * -0.35, SIZE), 1);
  assert.equal(cleanGlobeJourneyOpacity(0), 0);
  assert.equal(cleanGlobeJourneyOpacity(0.2), 1);
  assert.equal(cleanGlobeJourneyOpacity(1), 1);
  assert.equal(cleanGlobeJourneyTravel(0), 0);
  assert.equal(cleanGlobeJourneyTravel(1), 1);
  assert.equal(cleanGlobeJourneyScale(0), 1);
  assert.equal(cleanGlobeJourneyScale(1), 1);
  assert.equal(FINALE_GLOBE_RISE, 0);
});

test("the closing globe is clipped to the card", () => {
  assert.equal(
    clipRectToViewport(
      { top: 50, right: 900, bottom: 700, left: 40 },
      { top: 0, right: 1000, bottom: 800, left: 0 },
      24,
    ),
    "inset(50px 100px 100px 40px round 24px)",
  );
});

test("the sky globe lands on the painted orb in both crops of the floor", () => {
  const origin = { left: 0, top: 0 };
  const orbAt = (
    fit: ReturnType<typeof finaleGlobeFit>,
    box: { width: number; height: number },
  ) => ({ x: fit.x / box.width, y: fit.y / box.height });

  // Wide card: the photo is scaled to the width and cropped top/bottom.
  const wideBox = { left: 0, top: 0, width: 1400, height: 800 };
  const wide = finaleGlobeFit(wideBox, origin);
  const drawnHeight = 1400 / FINALE_SKY.aspect;
  assert.equal(wide.x, 1400 * FINALE_SKY.centerX);
  assert.equal(wide.diameter, 1400 * FINALE_SKY.diameter * 0.92);
  // Narrow card: scaled to the height and cropped on the sides instead.
  const tallBox = { left: 0, top: 0, width: 400, height: 700 };
  const tall = finaleGlobeFit(tallBox, origin);
  const drawnWidth = 700 * FINALE_SKY.aspect;
  assert.equal(tall.diameter, drawnWidth * FINALE_SKY.diameter * 0.92);

  // The crop can only slide where it overflows, and it slides as far as it
  // needs to: a wide card has no horizontal slack, so the orb keeps the
  // photo's own 23%, while a narrow one — which would otherwise push the orb
  // off the left edge entirely — pulls it back to the anchor.
  assert.ok(Math.abs(orbAt(wide, wideBox).x - 441 / 1920) < 0.001);
  assert.ok(Math.abs(orbAt(tall, tallBox).x - 0.42) < 0.01, `orb x ${orbAt(tall, tallBox).x}`);
  for (const [fit, box] of [[wide, wideBox], [tall, tallBox]] as const) {
    assert.ok(Math.abs(orbAt(fit, box).y - 0.42) < 0.01, `orb y ${orbAt(fit, box).y}`);
  }

  // The focus handed back to the <img> is what produced that crop, and it
  // stays inside the image: no gap at either edge.
  for (const fit of [wide, tall]) {
    assert.ok(fit.focusX >= 0 && fit.focusX <= 1);
    assert.ok(fit.focusY >= 0 && fit.focusY <= 1);
  }

  // The mesh stays inside the painted orb so its fire rings the 3D globe.
  assert.ok(wide.diameter < 1400 * FINALE_SKY.diameter);
  // The terrace cut sits well below the orb, and inside the visible card.
  assert.ok(wide.ridge > wide.y + wide.diameter);
  assert.ok(wide.ridge < 800);
  assert.ok(tall.ridge > tall.y + tall.diameter && tall.ridge < 700);
  // A crop with nowhere to slide keeps the photo centred.
  assert.equal(
    finaleGlobeFit({ left: 0, top: 0, width: 1400, height: drawnHeight }, origin).focusY,
    0.5,
  );

  // The fit is stated relative to the canvas the globe is drawn into.
  const shifted = finaleGlobeFit(
    { left: 60, top: 40, width: 1400, height: 800 },
    { left: 60, top: 40 },
  );
  assert.deepEqual(shifted, wide);

  const empty = finaleGlobeFit({ left: 0, top: 0, width: 0, height: 800 }, origin);
  assert.equal(empty.diameter, 0);

  // Solid blur must cover the painted sun's limb (radius ~0.54 of the globe).
  assert.ok(FINALE_SUN_BLUR_RADIUS * 0.64 > 0.54);
});
