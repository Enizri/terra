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
  // Both stops of the shared journey disc must stay charcoal, independent of
  // the CTA fill in the token palette.
  assert.match(css, /#232323 0%/);
  assert.match(css, /#232323 78%/);
  assert.doesNotMatch(source, /HeroTitle/);
  assert.doesNotMatch(source, /sh-hero-pin/);
  // Clip is not in public/ yet — HeroDemo.tsx stays, but must not mount.
  assert.doesNotMatch(source, /from "\.\/HeroDemo"/);
});

test("the globe is grabbed and spun, with no hover effects left", () => {
  // Every pointer-hover behaviour is gone: no decoder lens, no map hole, no
  // mouse-look. The only pointer path is press, drag, release.
  assert.doesNotMatch(journeySource, /RepoDiagram/);
  assert.doesNotMatch(journeySource, /hoverOnly/);
  assert.doesNotMatch(journeySource, /HOVER_R/);
  assert.doesNotMatch(journeySource, /clipPath/);
  assert.doesNotMatch(journeySource, /layoutInterior/);
  assert.match(journeySource, /gx-journey__grab/);
  assert.match(journeySource, /pointerdown/);
  assert.match(journeySource, /setPointerCapture/);
  assert.match(journeySource, /\(pointer: fine\)/);
  assert.doesNotMatch(css, /\.hx-orb__map/);
  assert.match(css, /\.gx-journey__grab\.is-grabbable[\s\S]*?cursor: grab/);
  // The hero paints above the sticky globe layer; if it took pointer events it
  // would swallow every press aimed at the handle.
  assert.match(css, /--herochars \{[\s\S]*?pointer-events: none/);
  assert.match(css, /--herochars \.hx-copy \{\s*pointer-events: auto/);
  assert.doesNotMatch(css, /#101116/);
});

test("reload plays the character bloom before the globe settles", () => {
  assert.match(journeySource, /let globeT = 0/);
  assert.match(journeySource, /globeT \+= dt \* globeJourneyClockRate\(progress\)/);
  assert.match(journeySource, /t:\s*globeT/);
  assert.doesNotMatch(journeySource, /t:\s*2 \+/);
});
