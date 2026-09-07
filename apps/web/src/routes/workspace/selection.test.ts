import assert from "node:assert/strict";
import test from "node:test";
import { askSelection, MAX_SELECTED, nextSelection } from "./selection.ts";

test("a plain click replaces the selection", () => {
  assert.deepEqual(nextSelection(["a", "b"], "c"), ["c"]);
});

test("clicking a picked card drops it", () => {
  assert.deepEqual(nextSelection(["a", "b"], "a"), ["b"]);
  assert.deepEqual(nextSelection(["a", "b"], "a", true), ["b"]);
});

test("additive clicks stack, oldest first, and stop at the cap", () => {
  let ids: string[] = [];
  for (const id of ["a", "b", "c", "d"]) ids = nextSelection(ids, id, true);
  assert.equal(ids.length, MAX_SELECTED);
  assert.deepEqual(ids, ["b", "c", "d"]);
});

test("asking about a part promotes it without dropping the stack", () => {
  // The subject is the last id, so asking about a card already in the stack
  // moves it to the end rather than toggling it off the way a click would.
  assert.deepEqual(askSelection(["a", "b", "c"], "a"), ["b", "c", "a"]);
  assert.deepEqual(askSelection(["a", "b"], "b"), ["a", "b"]);
});

test("asking about an unselected part makes it the whole question", () => {
  assert.deepEqual(askSelection(["a", "b"], "z"), ["z"]);
  assert.deepEqual(askSelection([], "z"), ["z"]);
});
