import assert from "node:assert/strict";
import test from "node:test";
import { ndjsonSplitter } from "./ndjson.ts";

test("emits whole lines from one chunk", () => {
  const feed = ndjsonSplitter<{ n: number }>();
  assert.deepEqual(feed('{"n":1}\n{"n":2}\n'), [{ n: 1 }, { n: 2 }]);
});

test("holds a line split across chunks", () => {
  const feed = ndjsonSplitter<{ n: number }>();
  assert.deepEqual(feed('{"n":'), []);
  assert.deepEqual(feed('1}\n'), [{ n: 1 }]);
});

test("never emits an unterminated tail", () => {
  const feed = ndjsonSplitter<{ n: number }>();
  assert.deepEqual(feed('{"n":1}\n{"n":2'), [{ n: 1 }]);
});

test("drops malformed lines instead of throwing", () => {
  const feed = ndjsonSplitter<{ n: number }>();
  assert.deepEqual(feed('{"n":1}\n<html>502</html>\n{"n":2}\n'), [{ n: 1 }, { n: 2 }]);
});
