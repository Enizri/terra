import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = import.meta.dirname;
const scaleCss = readFileSync(path.join(route, "styles/landing-scale.css"), "utf8");

test("the playground window keeps its fixed width token", () => {
  // playground.css sizes the window off this token; a stray edit there would
  // silently fall back to the 720px literal instead of failing.
  assert.match(scaleCss, /--sh-hero-window:\s*720px/);
});

test("desktop landing content keeps the requested 150 percent reading scale", () => {
  assert.match(scaleCss, /@media \(min-width: 901px\)[\s\S]*--sh-read:\s*1\.5/);
});
