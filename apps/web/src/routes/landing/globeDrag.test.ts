// The spin physics is pure, so the feel — clamped tilt, capped fling, the
// coast decaying back to rest — is checkable without a canvas or a pointer.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FLING,
  PITCH_LIMIT,
  advanceSpin,
  createSpin,
  dragBy,
  grab,
  release,
  spinChurn,
} from "./globeDrag.ts";

const RADIUS = 280;

test("dragging turns the globe and pitch stays inside its limit", () => {
  const spin = createSpin();
  dragBy(spin, RADIUS, 0, RADIUS, 1 / 60);
  assert.ok(spin.yaw > 0.5, `a radius of drag is a real turn (${spin.yaw})`);

  for (let i = 0; i < 40; i++) dragBy(spin, 0, RADIUS, RADIUS, 1 / 60);
  assert.equal(spin.pitch, PITCH_LIMIT);
  for (let i = 0; i < 80; i++) dragBy(spin, 0, -RADIUS, RADIUS, 1 / 60);
  assert.equal(spin.pitch, -PITCH_LIMIT);
});

test("the globe stops dead under the finger and flings on release", () => {
  const spin = createSpin();
  spin.yawVel = 4;
  grab(spin);
  assert.equal(spin.yawVel, 0, "grabbing kills the coast");

  for (let i = 0; i < 10; i++) dragBy(spin, 30, 0, RADIUS, 1 / 60);
  assert.equal(spin.yawVel, 0, "no coasting while the pointer is down");
  release(spin);
  assert.ok(spin.yawVel > 0, "the flick becomes velocity");
});

test("a violent flick is capped", () => {
  const spin = createSpin();
  for (let i = 0; i < 20; i++) dragBy(spin, 4000, 4000, RADIUS, 1 / 240);
  release(spin);
  assert.equal(spin.yawVel, MAX_FLING);
  assert.ok(spin.pitchVel <= MAX_FLING);
});

test("the throw coasts, decays, and parks level", () => {
  const spin = createSpin();
  spin.yaw = 0;
  spin.pitch = 0.3;
  spin.yawVel = 5;

  let moving = advanceSpin(spin, 1 / 60, false);
  assert.ok(moving);
  assert.ok(spin.yaw > 0, "it keeps turning after release");

  let previous = spin.yawVel;
  for (let i = 0; i < 30; i++) {
    advanceSpin(spin, 1 / 60, false);
    assert.ok(spin.yawVel <= previous, "velocity only falls");
    previous = spin.yawVel;
  }

  for (let i = 0; i < 600 && moving; i++) moving = advanceSpin(spin, 1 / 60, false);
  assert.equal(moving, false, "it eventually parks");
  assert.equal(spin.yawVel, 0);
  assert.equal(spin.pitch, 0, "the tilt settles back to level");
});

test("dragging holds the frame loop open and churn tracks the spin", () => {
  const spin = createSpin();
  assert.equal(advanceSpin(spin, 1 / 60, true), true, "a held globe keeps drawing");
  assert.equal(advanceSpin(spin, 1 / 60, false), false, "an idle one lets it stop");

  spin.yawVel = 3;
  spin.pitchVel = -1;
  assert.equal(spinChurn(spin), 4);
});
