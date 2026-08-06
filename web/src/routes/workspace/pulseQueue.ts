// Sequencing for trace pulses: spans that arrive within a short window are
// one request's path through the app (edge → server → client), so their
// cards pulse in arrival order with a stagger instead of stomping on each
// other. Pure state-in, state-out — MapStage owns the timers.

/** Spans this close together are one animated path. */
export const WINDOW_MS = 1500;
/** Delay between consecutive pulses of one path. */
export const STAGGER_MS = 250;

export interface QueueState {
  /** Last id enqueued, for consecutive-duplicate dedupe within the window. */
  lastId: string | null;
  /** Arrival time of the last span, window anchor. */
  lastArrival: number;
  /** Earliest time the next pulse may show. */
  nextFree: number;
}

export const emptyQueue: QueueState = { lastId: null, lastArrival: -Infinity, nextFree: 0 };

/**
 * Feed one mapped span into the queue. Returns the next state plus `showAt`,
 * the absolute time the id should pulse — or null when nothing should
 * (unmapped span, or a consecutive repeat of the same card).
 */
export function enqueue(
  state: QueueState,
  id: string | null,
  now: number,
): { state: QueueState; showAt: number | null } {
  if (!id) return { state, showAt: null };
  const inWindow = now - state.lastArrival <= WINDOW_MS;
  if (inWindow && id === state.lastId) {
    // Same card again (polling, retries): keep the window open, pulse nothing.
    return { state: { ...state, lastArrival: now }, showAt: null };
  }
  // Inside the window, queue behind earlier pulses; a fresh window shows now.
  const showAt = inWindow ? Math.max(now, state.nextFree) : now;
  return {
    state: { lastId: id, lastArrival: now, nextFree: showAt + STAGGER_MS },
    showAt,
  };
}
