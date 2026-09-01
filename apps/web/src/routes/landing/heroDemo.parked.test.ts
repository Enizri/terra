import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("HeroDemo module is parked on disk until the clip exists", () => {
  const parked = path.join(import.meta.dirname, "sections/HeroDemo.tsx");
  assert.equal(existsSync(parked), true);
});
