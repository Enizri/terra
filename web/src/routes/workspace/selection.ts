/** Selection click rules (React-free for tests). */

import { MAX_SELECTIONS } from "../../shared/limits.ts";

export const MAX_SELECTED = MAX_SELECTIONS;

/** Toggle if already picked; else replace, or stack (additive) with cap. */
export function nextSelection(prev: string[], id: string, additive = false): string[] {
  if (prev.includes(id)) return prev.filter((x) => x !== id);
  if (!additive) return [id];
  return [...prev, id].slice(-MAX_SELECTED);
}
