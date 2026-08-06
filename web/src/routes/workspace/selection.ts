/**
 * What a click does to the picked set. Deliberately React-free and
 * dependency-free so `npm test` can run it directly — every other rule about
 * the selection (labels, payloads) is rendering, and lives with the view.
 */

import { MAX_SELECTIONS } from "../../shared/limits.ts";

/** Cap on stacked cards — the shared rule, re-exported under this module's name. */
export const MAX_SELECTED = MAX_SELECTIONS;

/**
 * Clicking a picked card unpicks it. A plain click replaces the selection; an
 * additive one (shift/⌘) stacks, and the oldest falls off at the cap.
 */
export function nextSelection(prev: string[], id: string, additive = false): string[] {
  if (prev.includes(id)) return prev.filter((x) => x !== id);
  if (!additive) return [id];
  return [...prev, id].slice(-MAX_SELECTED);
}
