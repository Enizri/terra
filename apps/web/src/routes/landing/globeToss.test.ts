// The throw physics is pure, so the feel — the 1:1 drag, the capped fling, the
// lossy bounce, the wait before the globe takes itself home — is checkable
// without a canvas or a pointer.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TOSS,
  RESTITUTION,
  RETURN_DELAY,
  advanceToss,
  createToss,
  grabToss,
  releaseToss,
  tossBy,
  tossYawGain,
} from "./globeToss.ts";

const RADIUS = 200;
const STEP = 1 / 60;
/** A sky card the sphere has room to fly in. */
const BOX = { left: -300, right: 300, top: -220, bottom: 220 };
const ROOM = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };

test("the globe tracks the pointer and stops at the walls", () => {
  const toss = createToss();
  grabToss(toss, 0, 0, RADIUS);
  tossBy(toss, 200, -80, STEP);
  assert.equal(toss.x, 200, "the drag is 1:1, not scaled");
  assert.equal(toss.y, -80);

  advanceToss(toss, STEP, true, BOX);
  assert.equal(toss.x, 200, "a held globe inside the card is left alone");

  tossBy(toss, 400, 0, STEP);
  advanceToss(toss, STEP, true, BOX);
  assert.equal(toss.x, BOX.right, "it cannot be dragged out of the card");
});

test("the flick becomes drift, and a violent one is capped", () => {
  const toss = createToss();
  grabToss(toss, 0, 0, RADIUS);
  for (let i = 0; i < 10; i++) tossBy(toss, 24, 0, STEP);
  assert.equal(toss.vx, 0, "no drifting while the pointer is down");
  releaseToss(toss);
  assert.ok(toss.vx > 0, "the flick becomes velocity");

  const hard = createToss();
  grabToss(hard, 0, 0, RADIUS);
  for (let i = 0; i < 20; i++) tossBy(hard, 4000, -4000, 1 / 240);
  releaseToss(hard);
  assert.equal(hard.vx, MAX_TOSS);
  assert.equal(hard.vy, -MAX_TOSS);
});

test("it bounces off the card, loses energy, and never escapes", () => {
  const toss = createToss();
  toss.x = BOX.right - 10;
  toss.vx = 1000;

  let bounced = false;
  for (let i = 0; i < 20 && !bounced; i++) {
    advanceToss(toss, STEP, false, BOX);
    bounced = toss.vx < 0;
  }
  assert.ok(bounced, "the wall turns it around");
  assert.equal(toss.x, BOX.right, "and it is set down on the wall, not past it");
  assert.ok(
    Math.abs(toss.vx) < 1000 * RESTITUTION + 1,
    `the bounce is lossy (${toss.vx})`,
  );

  toss.vx = MAX_TOSS;
  toss.vy = -MAX_TOSS;
  for (let i = 0; i < 900; i++) {
    advanceToss(toss, STEP, false, BOX);
    assert.ok(toss.x >= BOX.left && toss.x <= BOX.right, `x escaped (${toss.x})`);
    assert.ok(toss.y >= BOX.top && toss.y <= BOX.bottom, `y escaped (${toss.y})`);
  }
});

test("a box too small for the sphere parks it in the middle", () => {
  const toss = createToss();
  toss.x = 90;
  toss.vx = 400;
  advanceToss(toss, STEP, false, { left: 20, right: -20, top: 5, bottom: -5 });
  assert.equal(toss.x, 0, "the collapsed box has one legal spot");
  assert.equal(toss.vx, 0);
});

test("it rests, waits out the delay, then glides home and settles", () => {
  const toss = createToss();
  toss.x = 210;
  toss.y = -140;

  for (let i = 0; i < Math.round((RETURN_DELAY - 0.2) * 60); i++) {
    advanceToss(toss, STEP, false, BOX);
  }
  assert.equal(toss.homing, false, "the return waits out its delay");
  assert.equal(toss.x, 210, "and nothing drifts while it waits");
  assert.ok(
    advanceToss(toss, STEP, false, BOX),
    "but the loop keeps drawing, or the return would never run",
  );

  let moving = true;
  let overshot = false;
  for (let i = 0; i < 60 * 8 && moving; i++) {
    moving = advanceToss(toss, STEP, false, BOX);
    if (toss.x < -0.5 || toss.y > 0.5) overshot = true;
  }
  assert.equal(overshot, false, "critically damped: it does not swing past");
  assert.equal(toss.x, 0, "it lands exactly on the sun");
  assert.equal(toss.y, 0);
  assert.equal(moving, false, "and only then does the loop get to park");
});

test("a long drift is never cut short by the return timer", () => {
  const toss = createToss();
  toss.vx = MAX_TOSS;
  for (let i = 0; i < Math.round((RETURN_DELAY + 0.5) * 60); i++) {
    advanceToss(toss, STEP, false, ROOM);
  }
  assert.equal(toss.homing, false, "the timer counts rest, not time since release");
  assert.ok(toss.vx > 0, "it is still coasting");
});

test("where you grab it decides how much of the drag becomes tumble", () => {
  const centre = createToss();
  grabToss(centre, 0, 0, RADIUS);
  tossBy(centre, 120, 0, STEP);

  const rim = createToss();
  grabToss(rim, 0, -RADIUS, RADIUS);
  tossBy(rim, 120, 0, STEP);

  assert.equal(centre.roll, 0, "a centre shove is a straight shove");
  assert.ok(Math.abs(rim.roll) > 0.5, `a rim shove rolls it (${rim.roll})`);
  assert.equal(centre.x, rim.x, "both still follow the pointer 1:1");
  assert.equal(tossYawGain(centre), 1, "the centre spends it all on the turn");
  assert.ok(tossYawGain(rim) < 1, "the rim trades turn away for roll");

  releaseToss(rim);
  assert.ok(rim.rollVel !== 0, "the tumble outlives the release");
});

test("a held globe holds the loop open and a docked one lets it park", () => {
  const toss = createToss();
  assert.equal(advanceToss(toss, STEP, true, BOX), true, "a held globe keeps drawing");
  assert.equal(advanceToss(toss, STEP, false, BOX), false, "a docked one lets it stop");
});
