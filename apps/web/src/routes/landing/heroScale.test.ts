import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = import.meta.dirname;
const scaleCss = readFileSync(path.join(route, "styles/landing-scale.css"), "utf8");
const showcaseCss = readFileSync(path.join(route, "styles/showcase.css"), "utf8");
const heroSource = readFileSync(path.join(route, "sections/Hero.tsx"), "utf8");

test("landing hero keeps the full-card geometry", () => {
  assert.match(showcaseCss, /min-height:\s*min\(calc\(80svh\s*-\s*108px\),\s*1020px\)/);
  assert.match(scaleCss, /--sh-hero-window:\s*720px/);
});

test("tall viewports do not vertically center the hero painting", () => {
  assert.doesNotMatch(heroSource, /window\.innerHeight\s*-\s*card\.offsetHeight/);
  assert.match(heroSource, /const stickTop = Math\.max\(0, pin\.offsetTop\)/);
});

test("desktop landing content keeps the requested 150 percent reading scale", () => {
  assert.match(scaleCss, /@media \(min-width: 901px\)[\s\S]*--sh-read:\s*1\.5/);
});
