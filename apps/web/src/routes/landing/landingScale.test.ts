import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const route = import.meta.dirname;
const scaleCss = readFileSync(path.join(route, "styles/landing-scale.css"), "utf8");
const foundationsCss = readFileSync(path.join(route, "styles/foundations.css"), "utf8");
const heroCardCss = readFileSync(path.join(route, "styles/hero-card.css"), "utf8");
const heroSource = readFileSync(path.join(route, "sections/Hero.tsx"), "utf8");
const landingSource = readFileSync(path.join(route, "TerraLanding.tsx"), "utf8");

test("the playground window keeps its fixed width token", () => {
  // playground.css sizes the window off this token; a stray edit there would
  // silently fall back to the 720px literal instead of failing.
  assert.match(scaleCss, /--sh-hero-window:\s*720px/);
});

test("landing hero keeps the full-card geometry", () => {
  assert.match(heroCardCss, /min-height:\s*min\(calc\(80svh\s*-\s*108px\),\s*1020px\)/);
  assert.match(scaleCss, /--sh-hero-window:\s*720px/);
});

test("tall viewports do not vertically center the hero painting", () => {
  assert.doesNotMatch(heroSource, /window\.innerHeight\s*-\s*card\.offsetHeight/);
  assert.match(heroSource, /const LANDING_GAP_MIN = 96/);
  // The pin centers the pre-drop drop window, not the expanded film.
  assert.match(heroSource, /HERO_SCREEN_PREDROP_PX/);
  assert.doesNotMatch(heroSource, /HERO_SCREEN_EXPANDED/);
});

test("the first hero is the GitHub drag screen, not the globe split", () => {
  assert.match(landingSource, /from "\.\/sections\/Hero"/);
  assert.doesNotMatch(landingSource, /HeroChars/);
  assert.doesNotMatch(landingSource, /from "\.\/HeroDemo"/);
  assert.match(heroSource, /sh-hero-pin/);
  assert.match(heroSource, /icon="github"/);
  assert.match(heroSource, /HeroScriptedDemo/);
  assert.doesNotMatch(heroSource, /from "\.\/HeroDemo"/);
});

test("desktop landing content keeps the requested 150 percent reading scale", () => {
  assert.match(scaleCss, /@media \(min-width: 901px\)[\s\S]*--sh-read:\s*1\.5/);
});

test("the sticky hero does not paint a second paper over the cursor trail", () => {
  // `.hx-field--trail` is a z-0 body overlay on `.sh-root--landing`. A fill on
  // `.sh-section--hero` hid that trail and read as a fake sheet.
  assert.match(foundationsCss, /\.sh-section--hero \{[\s\S]*?background:\s*none/);
  assert.match(heroCardCss, /\.sh-power-theater\.sh-hero-card[\s\S]*?background:\s*none/);
});
