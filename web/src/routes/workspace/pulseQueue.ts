// Trace-pulse sequencing: stagger spans in a short window (MapStage owns timers).

export const WINDOW_MS = 1500;
export const STAGGER_MS = 250;

export interface QueueState {
  lastId: string | null;
  lastArrival: number;
  nextFree: number;
}

export const emptyQueue: QueueState = { lastId: null, lastArrival: -Infinity, nextFree: 0 };

/** Enqueue a mapped span; `showAt` is null for unmapped or consecutive dupes. */
export function enqueue(
  state: QueueState,
  id: string | null,
  now: number,
): { state: QueueState; showAt: number | null } {
  if (!id) return { state, showAt: null };
  const inWindow = now - state.lastArrival <= WINDOW_MS;
  if (inWindow && id === state.lastId) {
    return { state: { ...state, lastArrival: now }, showAt: null };
  }
  const showAt = inWindow ? Math.max(now, state.nextFree) : now;
  return {
    state: { lastId: id, lastArrival: now, nextFree: showAt + STAGGER_MS },
    showAt,
  };
}
