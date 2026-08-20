import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const css = readFileSync(path.join(import.meta.dirname, "styles/hero-chars.css"), "utf8");
const source = readFileSync(path.join(import.meta.dirname, "sections/HeroChars.tsx"), "utf8");

test("hero is a 1:1 split with the globe on charcoal", () => {
  assert.match(css, /grid-template-columns:\s*1fr 1fr/);
  assert.match(css, /background:\s*#232323/);
  assert.doesNotMatch(source, /HeroTitle/);
  assert.doesNotMatch(source, /sh-hero-pin/);
});
