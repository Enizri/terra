import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const css = readFileSync(path.join(import.meta.dirname, "styles/hero-chars.css"), "utf8");
const source = readFileSync(path.join(import.meta.dirname, "sections/HeroChars.tsx"), "utf8");

test("hero is a 1:1 split with the globe on charcoal", () => {
  assert.match(css, /grid-template-columns:\s*1fr 1fr/);
  assert.match(css, /background:\s*#232323/);
  assert.match(css, /#232323 78%/);
  assert.doesNotMatch(source, /HeroTitle/);
  assert.doesNotMatch(source, /sh-hero-pin/);
});

test("hover hole shows the playground RepoDiagram, not glyph labels", () => {
  assert.match(source, /RepoDiagram/);
  assert.match(source, /hoverOnly/);
  assert.match(source, /HOVER_R/);
  assert.doesNotMatch(source, /layoutInterior/);
  assert.match(css, /\.hx-orb__map/);
  assert.match(css, /clip-path:\s*circle\(0px at 50% 50%\)/);
  assert.doesNotMatch(css, /#101116/);
});
