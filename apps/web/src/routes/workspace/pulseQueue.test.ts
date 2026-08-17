import assert from "node:assert/strict";
import test from "node:test";
import { emptyQueue, enqueue, STAGGER_MS, WINDOW_MS, type QueueState } from "./pulseQueue.ts";

/** Run a sequence of (id, at) arrivals and collect the scheduled pulses. */
function run(arrivals: [string | null, number][]): [string, number][] {
  let state: QueueState = emptyQueue;
  const shown: [string, number][] = [];
  for (const [id, at] of arrivals) {
    const r = enqueue(state, id, at);
    state = r.state;
    if (r.showAt != null) shown.push([id as string, r.showAt]);
  }
  return shown;
}

test("a lone span pulses immediately", () => {
  assert.deepEqual(run([["web", 1000]]), [["web", 1000]]);
});

test("nulls are skipped and do not disturb the queue", () => {
  assert.deepEqual(
    run([
      [null, 1000],
      ["web", 1001],
      [null, 1002],
    ]),
    [["web", 1001]],
  );
});

test("spans within the window stagger in arrival order", () => {
  assert.deepEqual(
    run([
      ["web", 1000],
      ["api", 1010],
      ["store", 1020],
    ]),
    [
      ["web", 1000],
      ["api", 1000 + STAGGER_MS],
      ["store", 1000 + 2 * STAGGER_MS],
    ],
  );
});

test("consecutive duplicates dedupe, non-consecutive repeats do not", () => {
  assert.deepEqual(
    run([
      ["web", 1000],
      ["web", 1010],
      ["api", 1020],
      ["web", 1030],
    ]),
    [
      ["web", 1000],
      ["api", 1000 + STAGGER_MS],
      ["web", 1000 + 2 * STAGGER_MS],
    ],
  );
});

test("a gap past the window resets the stagger and the dedupe", () => {
  const later = 1000 + WINDOW_MS + 1;
  assert.deepEqual(
    run([
      ["web", 1000],
      ["web", later],
    ]),
    [
      ["web", 1000],
      ["web", later],
    ],
  );
});

test("an arrival after the backlog drains pulses at its own time", () => {
  // Third span arrives inside the window but after nextFree has passed.
  assert.deepEqual(
    run([
      ["web", 1000],
      ["api", 1001],
      ["store", 1900],
    ]),
    [
      ["web", 1000],
      ["api", 1000 + STAGGER_MS],
      ["store", 1900],
    ],
  );
});
