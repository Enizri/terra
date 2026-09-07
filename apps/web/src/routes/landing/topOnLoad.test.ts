// A reload starts the ride over. Source assertions: the behaviour is three
// browser calls on mount, and what matters is that all three are there and in
// the right order — the hash has to come off before we scroll, or the browser
// re-resolves it as the named section mounts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = readFileSync(
  path.join(import.meta.dirname, "TerraLanding.tsx"),
  "utf8",
);

test("the landing owns scroll restoration while it is mounted", () => {
  assert.match(source, /history\.scrollRestoration = "manual"/);
  // Put back on the way out: restoration belongs to the history, not the route.
  assert.match(source, /const previous = history\.scrollRestoration/);
  assert.match(source, /history\.scrollRestoration = previous/);
});

test("the hash is dropped before the page is sent to the top", () => {
  const strip = source.search(/history\.replaceState\(null, "", pathname \+ search\)/);
  const top = source.search(/window\.scrollTo\(0, 0\)/);
  assert.ok(strip > 0, "the fragment is cleared on mount");
  assert.ok(top > strip, "and the scroll to the hero follows it");
  // location.hash = "" would scroll the page itself.
  assert.doesNotMatch(source, /location\.hash =/);
});

test("the reset runs before the scroll loop reads where the page is", () => {
  const reset = source.indexOf("useTopOnLoad()");
  const loop = source.indexOf("useSmoothAnchors(useSmoothScroll())");
  assert.ok(reset > 0 && loop > reset, "useTopOnLoad is called first");
  // A layout effect lands before useSmoothScroll's effect seeds its target.
  assert.match(source, /function useTopOnLoad\(\) \{\s*useLayoutEffect\(/);
});
