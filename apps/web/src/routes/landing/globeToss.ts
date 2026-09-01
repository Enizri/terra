/* Throw-and-drift for the docked finale globe. The sphere hangs in air, so a
   press moves it rather than only turning it: it follows the pointer, keeps the
   momentum of the flick, bounces off the walls of the sky card, and — once it
   has been left alone long enough — settles back onto the painted sun it came
   from. Kept free of DOM for the same reason globeDrag.ts is: the feel is the
   thing worth testing, and none of it needs a canvas.

   This module owns position and roll. Yaw and pitch stay in globeDrag.ts. */

/** Velocity left after one second of coasting. Far less drag than the spin,
 *  because a shoved object in air keeps going a good while. */
export const SPACE_DRAG = 0.3;
/** The tumble outlives the drift: angular momentum barely bleeds off. */
export const ROLL_DRAG = 0.6;
/** Throw ceiling, px/s — a violent flick must not teleport the globe. */
export const MAX_TOSS = 2600;
/** Tumble ceiling, rad/s. */
export const MAX_ROLL = 9;
/** Speed kept through a wall bounce. Lossy, so a throw always ends. */
export const RESTITUTION = 0.6;
/** Below this the drift is treated as parked, px/s. */
export const REST_SPEED = 12;
/** Below this the tumble is parked, rad/s. */
const REST_ROLL = 0.02;
/** Seconds at rest before the globe takes itself home. The timer counts rest,
 *  not time since release, so a long slow drift is never cut short. */
export const RETURN_DELAY = 3;
/** Spring constant of the glide home. Critically damped, so it never
 *  overshoots the sun and bounces back off it. */
export const HOME_STIFFNESS = 26;
/** Drag of one globe radius, applied at the rim, rolls this much. */
export const ROLL_PER_RADIUS = 2.2;
/** How much of the yaw/pitch turn a rim grab trades away for roll. */
export const CENTRE_BIAS = 0.65;
/** Weight of the newest sample in the velocity EMA — a flick is the last few
 *  moves, not the single frame the finger happened to lift on. */
const VEL_SMOOTH = 0.35;
/** Close enough to home to call it docked: px, and px/s. */
const HOME_EPS = 0.4;
const HOME_VEL_EPS = 6;

/** The box the sphere may fly in, as offsets from its docked spot. */
export type TossBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type TossState = {
  /** Offset from the docked spot, px. Home is (0, 0). */
  x: number;
  y: number;
  /** Coasting velocity, px/s — zero while the pointer is down. */
  vx: number;
  vy: number;
  /** Smoothed drag velocity, promoted to vx/vy on release. */
  emaVx: number;
  emaVy: number;
  /** Tumble about the view axis, rad, and its coast. */
  roll: number;
  rollVel: number;
  emaRoll: number;
  /** Where the press landed, in globe radii from the centre, clamped to the
   *  rim. A centre grab shoves; a rim grab also spins. */
  leverX: number;
  leverY: number;
  /** Globe radius at the moment of the grab, px. */
  radius: number;
  /** Seconds spent at rest since the throw died. */
  idle: number;
  /** True once the return spring has taken over. */
  homing: boolean;
};

export function createToss(): TossState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    emaVx: 0,
    emaVy: 0,
    roll: 0,
    rollVel: 0,
    emaRoll: 0,
    leverX: 0,
    leverY: 0,
    radius: 1,
    idle: 0,
    homing: false,
  };
}

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

/** Keeps `state` inside `bounds`, tolerating a box too small for the sphere
 *  (a narrow card) by parking it in the middle of whatever room there is. */
function confine(state: TossState, bounds: TossBounds, bounce: boolean) {
  const axis = (
    pos: number,
    vel: number,
    min: number,
    max: number,
  ): [number, number] => {
    if (max < min) return [(min + max) / 2, 0];
    if (pos < min) return [min, bounce ? -vel * RESTITUTION : 0];
    if (pos > max) return [max, bounce ? -vel * RESTITUTION : 0];
    return [pos, vel];
  };
  [state.x, state.vx] = axis(state.x, state.vx, bounds.left, bounds.right);
  [state.y, state.vy] = axis(state.y, state.vy, bounds.top, bounds.bottom);
}

/** Pointer down: the globe stops dead under the finger, and where the finger
 *  landed decides how much of the drag becomes tumble. */
export function grabToss(
  state: TossState,
  offsetX: number,
  offsetY: number,
  radiusPx: number,
) {
  const r = Math.max(1, radiusPx);
  state.vx = 0;
  state.vy = 0;
  state.emaVx = 0;
  state.emaVy = 0;
  state.rollVel = 0;
  state.emaRoll = 0;
  state.idle = 0;
  state.homing = false;
  state.radius = r;
  // A press outside the disc (the pad is square-ish at its corners) is pulled
  // back to the rim, so the lever never exceeds one radius.
  const lx = offsetX / r;
  const ly = offsetY / r;
  const len = Math.hypot(lx, ly);
  const scale = len > 1 ? 1 / len : 1;
  state.leverX = lx * scale;
  state.leverY = ly * scale;
}

/** Applies one pointer move. The globe tracks the pointer exactly; `dt` is the
 *  time since the previous move, so a slow drag and a fast one of the same
 *  distance are thrown differently. */
export function tossBy(state: TossState, dxPx: number, dyPx: number, dt: number) {
  state.x += dxPx;
  state.y += dyPx;
  // Lever × drag: pushing the rim sideways rolls the sphere, pushing its
  // centre does not.
  const dRoll =
    ((state.leverX * dyPx - state.leverY * dxPx) / state.radius) *
    ROLL_PER_RADIUS;
  state.roll += dRoll;
  state.vx = 0;
  state.vy = 0;
  state.rollVel = 0;
  state.idle = 0;
  state.homing = false;
  if (dt <= 0) return;
  state.emaVx += (dxPx / dt - state.emaVx) * VEL_SMOOTH;
  state.emaVy += (dyPx / dt - state.emaVy) * VEL_SMOOTH;
  state.emaRoll += (dRoll / dt - state.emaRoll) * VEL_SMOOTH;
}

/** Pointer up: hand the smoothed drag velocity to the drift. */
export function releaseToss(state: TossState) {
  state.vx = clamp(state.emaVx, MAX_TOSS);
  state.vy = clamp(state.emaVy, MAX_TOSS);
  state.rollVel = clamp(state.emaRoll, MAX_ROLL);
  state.emaVx = 0;
  state.emaVy = 0;
  state.emaRoll = 0;
  state.idle = 0;
  state.homing = false;
}

/** How much of the gesture is left for globeDrag's yaw and pitch: all of it at
 *  the centre, most of it traded for roll at the rim. */
export function tossYawGain(state: TossState) {
  const lever = Math.min(1, Math.hypot(state.leverX, state.leverY));
  return 1 - CENTRE_BIAS * lever;
}

/** Integrates one frame. Returns true while the globe is still moving *or*
 *  still away from its dock — the render loop must keep drawing through the
 *  quiet wait before the return, not only through the throw. */
export function advanceToss(
  state: TossState,
  dt: number,
  dragging: boolean,
  bounds: TossBounds,
) {
  if (dragging) {
    confine(state, bounds, false);
    return true;
  }

  if (state.homing) {
    // Critically damped: the globe is drawn back onto the sun and arrives, it
    // does not swing past it.
    const c = 2 * Math.sqrt(HOME_STIFFNESS);
    state.vx += (-HOME_STIFFNESS * state.x - c * state.vx) * dt;
    state.vy += (-HOME_STIFFNESS * state.y - c * state.vy) * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    if (
      Math.abs(state.x) < HOME_EPS &&
      Math.abs(state.y) < HOME_EPS &&
      Math.hypot(state.vx, state.vy) < HOME_VEL_EPS
    ) {
      state.x = 0;
      state.y = 0;
      state.vx = 0;
      state.vy = 0;
      state.homing = false;
    }
  } else {
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    const decay = Math.pow(SPACE_DRAG, dt);
    state.vx *= decay;
    state.vy *= decay;
    confine(state, bounds, true);
    if (Math.hypot(state.vx, state.vy) < REST_SPEED) {
      state.vx = 0;
      state.vy = 0;
      state.idle += dt;
      if (state.idle >= RETURN_DELAY && (state.x !== 0 || state.y !== 0)) {
        state.homing = true;
      }
    } else {
      state.idle = 0;
    }
  }

  state.roll += state.rollVel * dt;
  state.rollVel *= Math.pow(ROLL_DRAG, dt);
  if (Math.abs(state.rollVel) < REST_ROLL) state.rollVel = 0;

  return (
    state.homing ||
    state.vx !== 0 ||
    state.vy !== 0 ||
    state.rollVel !== 0 ||
    state.x !== 0 ||
    state.y !== 0
  );
}
