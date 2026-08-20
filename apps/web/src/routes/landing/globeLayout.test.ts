// The globe's whole look is decided in globeLayout, so this is where it can be
// checked without a GPU: run a frame, read back the quads.
import assert from "node:assert/strict";
import test from "node:test";
import { copy } from "./data.ts";
import {
  INSTANCE_FLOATS,
  MAX_INSTANCES,
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
  pointerX: -1e4,
  pointerY: -1e4,
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

test("the cursor lens decodes the scramble into readable copy", () => {
  const glyphs: string[] = [];
  layoutGlobe(frame(), buf, glyphs);
  assert.ok(!glyphs.join("").includes(" "), "no spaces: nothing resolves off-cursor");

  // Park the cursor on the middle of the globe.
  const lit: string[] = [];
  const n = layoutGlobe(frame({ pointerX: SIZE / 2, pointerY: SIZE / 2 }), buf, lit);
  // Quads come out in ring order with cells in sequence — the order the
  // sentence is laid down in — so read it back the same way.
  const near = lit
    .filter((_, i) => {
      const o = i * INSTANCE_FLOATS;
      return Math.hypot(buf[o] - SIZE / 2, buf[o + 1] - SIZE / 2) < SIZE * 0.15;
    })
    .join("");
  assert.ok(n > 100);
  // Which words land under the cursor depends on where the rings happen to be,
  // so assert on the property that matters: a run of the sentence comes out
  // intact rather than isolated letters in a sea of noise.
  const RUN = 8;
  const intact = Array.from({ length: Math.max(0, near.length - RUN) }, (_, i) =>
    near.slice(i, i + RUN),
  ).some((run) => copy.heroGlobeText.includes(run));
  assert.ok(intact, `lens should resolve a readable run, got ${near.slice(0, 80)}`);
});

test("reduced motion still lays out a full globe, with no lens", () => {
  const glyphs: string[] = [];
  const n = layoutGlobe(
    frame({ reduced: true, pointerX: SIZE / 2, pointerY: SIZE / 2 }),
    buf,
    glyphs,
  );
  assert.ok(n > 1800);
  assert.ok(spread(n) > SIZE * 0.6, "opens immediately, no intro to wait through");
  assert.ok(!glyphs.join("").includes(" "), "the lens is off");
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

  const middle = journey(0.65);
  const middleHeight = Math.max(
    ...Array.from({ length: middle }, (_, i) => buf[i * INSTANCE_FLOATS + 1]),
  ) - Math.min(...Array.from({ length: middle }, (_, i) => buf[i * INSTANCE_FLOATS + 1]));
  assert.ok(middleHeight > SIZE * 0.75, "middle stretches into long streams");
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

  assert.equal(globeJourneyProgress(20, SIZE * 2, SIZE), 0);
  assert.ok(globeJourneyProgress(-SIZE / 2, SIZE * 0.6, SIZE) > 0.5);
  assert.equal(globeJourneyProgress(-SIZE, SIZE * 0.24, SIZE), 1);
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
