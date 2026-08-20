import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const css = readFileSync(path.join(import.meta.dirname, "styles/hero-chars.css"), "utf8");
const source = readFileSync(path.join(import.meta.dirname, "sections/HeroChars.tsx"), "utf8");
const journeySource = readFileSync(
  path.join(import.meta.dirname, "sections/GlobeJourney.tsx"),
  "utf8",
);

test("hero is a 1:1 split with the globe on charcoal", () => {
  assert.match(css, /grid-template-columns:\s*1fr 1fr/);
  // Both stops of the shared journey disc. The solid core used to be guarded by a
  // bare `background: #232323`, which actually matched the hero CTA's fill —
  // it stopped being charcoal when the buttons moved to the token palette.
  assert.match(css, /#232323 0%/);
  assert.match(css, /#232323 78%/);
  assert.doesNotMatch(source, /HeroTitle/);
  assert.doesNotMatch(source, /sh-hero-pin/);
});

test("hover hole shows the playground RepoDiagram, not glyph labels", () => {
  assert.match(journeySource, /RepoDiagram/);
  assert.match(journeySource, /hoverOnly/);
  assert.match(journeySource, /HOVER_R/);
  assert.doesNotMatch(journeySource, /layoutInterior/);
  assert.match(css, /\.hx-orb__map/);
  assert.match(css, /clip-path:\s*circle\(0px at 50% 50%\)/);
  assert.doesNotMatch(css, /#101116/);
});

test("reload plays the character bloom before the globe settles", () => {
  assert.match(journeySource, /let globeT = 0/);
  assert.match(journeySource, /globeT \+= dt \* globeJourneyClockRate\(progress\)/);
  assert.match(journeySource, /t:\s*globeT/);
  assert.doesNotMatch(journeySource, /t:\s*2 \+/);
});
