import assert from "node:assert/strict";
import test from "node:test";
import { showFixture } from "./demo.ts";

test("a demo build seeds the fixture with no query string", () => {
  assert.equal(showFixture("", false, true), true);
  assert.equal(showFixture("?tab=map", false, true), true);
});

test("?nofixture gets the empty stage back in a demo build", () => {
  assert.equal(showFixture("?nofixture", false, true), false);
  assert.equal(showFixture("?tab=map&nofixture", false, true), false);
});

test("dev keeps the ?fixture opt-in it always had", () => {
  assert.equal(showFixture("?fixture", true, false), true);
  assert.equal(showFixture("", true, false), false);
});

test("a plain production build never seeds the fixture", () => {
  assert.equal(showFixture("", false, false), false);
  assert.equal(showFixture("?fixture", false, false), false);
});
