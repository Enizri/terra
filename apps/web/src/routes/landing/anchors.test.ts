// Nav anchors: the offset maths, plus the wiring itself — a link pointing at
// an id no section carries would silently do nothing in the browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ANCHOR_GAP, anchorId, anchorScrollTop } from "./anchors.ts";

test("a section parks just below the sticky nav", () => {
  // 600px down the page, section 400px below the fold, 64px of nav.
  assert.equal(anchorScrollTop(600, 400, 64, 1e6), 936 - ANCHOR_GAP);
});

test("the target stays inside the scrollable range", () => {
  assert.equal(anchorScrollTop(0, -5000, 64, 4000), 0, "never above the top");
  assert.equal(anchorScrollTop(3900, 500, 64, 4000), 4000, "never past the bottom");
});

test("a bare hash means the top of the page", () => {
  assert.equal(anchorId("#power"), "power");
  assert.equal(anchorId("#"), null);
  assert.equal(anchorId("/new"), null);
  assert.equal(anchorId(null), null);
});

const read = (file: string) =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

test("every nav link lands on a section that exists", () => {
  const nav = read("sections/SiteNav.tsx");
  const targets = [...nav.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ["top", "power", "faq"]);

  assert.match(read("sections/Hero.tsx"), /id="top"/);
  assert.match(read("sections/PowerSection.tsx"), /id="power"/);
  assert.match(read("sections/Faq.tsx"), /id="faq"/);
  // The hero's secondary CTA rides the same handler.
  assert.match(read("data.ts"), /href: "#power"/);
  // One scroll owner: anchor clicks glide through the same eased loop the
  // wheel uses, so a click never fights a native smooth scroll.
  assert.match(read("TerraLanding.tsx"), /useSmoothAnchors\(useSmoothScroll\(\)\)/);
  assert.doesNotMatch(read("TerraLanding.tsx"), /behavior: "smooth"/);
  // Closing card lives inside the journey so the last globe can dock in it.
  assert.match(read("TerraLanding.tsx"), /<Faq \/>\s*<Final \/>/);
  assert.match(read("sections/Final.tsx"), /gx-journey__footer-dock/);
  // The foreground is painted a second time, over the globe, so it sits behind it.
  assert.match(read("sections/Final.tsx"), /terra-finale__fore/);
  assert.match(read("sections/Final.tsx"), /terra-finale__sun/);
  assert.match(read("sections/Final.tsx"), /finale-sky\.jpg/);
});
