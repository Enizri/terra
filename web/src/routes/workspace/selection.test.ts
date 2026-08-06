import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SELECTED, nextSelection } from "./selection.ts";

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
