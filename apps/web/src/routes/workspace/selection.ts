/** Selection click rules (React-free for tests). */

import { MAX_SELECTIONS } from "../../shared/limits.ts";

export const MAX_SELECTED = MAX_SELECTIONS;

/** Make `id` the subject of the next question.
 *
 * Not the same rule as a click: asking about a part must never toggle it off,
 * and a stack the reader built with shift-click is theirs to keep — the subject
 * just moves to the end of it. An id that was not selected at all replaces the
 * stack, because "ask about this" is a statement about one part. */
export function askSelection(prev: string[], id: string): string[] {
  if (prev[prev.length - 1] === id) return prev;
  if (!prev.includes(id)) return [id];
  return [...prev.filter((x) => x !== id), id];
}

/** Toggle if already picked; else replace, or stack (additive) with cap. */
export function nextSelection(prev: string[], id: string, additive = false): string[] {
  if (prev.includes(id)) return prev.filter((x) => x !== id);
  if (!additive) return [id];
  return [...prev, id].slice(-MAX_SELECTED);
}
