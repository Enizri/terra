/* Press-and-spin for the hero globe. Kept free of DOM so the physics — clamp,
   fling, friction, the pitch settling back to level — is testable the same way
   the layout maths in globeLayout.ts is. */

/** How far the pitch may tilt from level, radians (~25°). */
export const PITCH_LIMIT = 0.44;
/** Drag of one globe radius sweeps this much yaw / pitch, radians. Scaling by
 *  radius keeps the feel identical on a phone-sized and a 4K-sized globe. */
export const YAW_PER_RADIUS = 2.4;
export const PITCH_PER_RADIUS = 1.2;
/** Velocity left after one second of coasting. */
export const FRICTION = 0.06;
/** Fling ceiling, rad/s — a violent flick must not blur the field to mush. */
export const MAX_FLING = 7;
/** Weight of the newest sample in the velocity EMA. A flick is the last few
 *  moves, not the single frame the finger happened to lift on. */
const VEL_SMOOTH = 0.35;
/** Pitch returns to level this fast once the throw has died, per second. */
export const PITCH_RETURN = 0.12;
/** Below this the globe is treated as parked and the loop may stop. */
const REST_VEL = 0.02;

export type SpinState = {
  yaw: number;
  pitch: number;
  /** Coasting velocity, rad/s — zero while the pointer is down. */
  yawVel: number;
  pitchVel: number;
  /** Smoothed drag velocity, promoted to yawVel/pitchVel on release. */
  emaYaw: number;
  emaPitch: number;
};

export function createSpin(): SpinState {
  return { yaw: 0, pitch: 0, yawVel: 0, pitchVel: 0, emaYaw: 0, emaPitch: 0 };
}

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

/** Applies one pointer move. `dt` is the time since the previous move, so a
 *  slow drag and a fast one of the same distance fling differently. */
export function dragBy(
  state: SpinState,
  dxPx: number,
  dyPx: number,
  radiusPx: number,
  dt: number,
) {
  const r = Math.max(1, radiusPx);
  const dYaw = (dxPx / r) * YAW_PER_RADIUS;
  const dPitch = (dyPx / r) * PITCH_PER_RADIUS;
  state.yaw += dYaw;
  state.pitch = clamp(state.pitch + dPitch, PITCH_LIMIT);
  state.yawVel = 0;
  state.pitchVel = 0;
  if (dt <= 0) return;
  state.emaYaw += (dYaw / dt - state.emaYaw) * VEL_SMOOTH;
  state.emaPitch += (dPitch / dt - state.emaPitch) * VEL_SMOOTH;
}

/** Pointer down: the globe stops dead under the finger. */
export function grab(state: SpinState) {
  state.yawVel = 0;
  state.pitchVel = 0;
  state.emaYaw = 0;
  state.emaPitch = 0;
}

/** Pointer up: hand the smoothed drag velocity to the coast. */
export function release(state: SpinState) {
  state.yawVel = clamp(state.emaYaw, MAX_FLING);
  state.pitchVel = clamp(state.emaPitch, MAX_FLING);
  state.emaYaw = 0;
  state.emaPitch = 0;
}

/** Integrates one frame. Returns true while the globe is still moving, so the
 *  render loop knows not to park mid-fling. */
export function advanceSpin(state: SpinState, dt: number, dragging: boolean) {
  if (dragging) return true;
  state.yaw += state.yawVel * dt;
  state.pitch = clamp(state.pitch + state.pitchVel * dt, PITCH_LIMIT);
  const decay = Math.pow(FRICTION, dt);
  state.yawVel *= decay;
  state.pitchVel *= decay;
  if (Math.abs(state.yawVel) < REST_VEL) state.yawVel = 0;
  if (Math.abs(state.pitchVel) < REST_VEL) state.pitchVel = 0;
  // Only once the throw is spent does the tilt drift back to level, so a
  // deliberate pitch is not fought while the finger is still in flight.
  if (state.pitchVel === 0) {
    state.pitch += (0 - state.pitch) * (1 - Math.pow(PITCH_RETURN, dt));
    if (Math.abs(state.pitch) < 1e-4) state.pitch = 0;
  }
  return state.yawVel !== 0 || state.pitchVel !== 0 || state.pitch !== 0;
}

/** Glyph churn tracks how hard the globe is turning. */
export function spinChurn(state: SpinState) {
  return Math.abs(state.yawVel) + Math.abs(state.pitchVel);
}
