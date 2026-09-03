import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const shell = import.meta.dirname;
const layoutCss = readFileSync(path.join(shell, "styles/layout.css"), "utf8");

test("the shell height is the viewport, not the viewport over the zoom scale", () => {
  // `zoom` already resolves viewport units against the element's effective
  // zoom, so `calc(100dvh / var(--sh-ws-scale))` divides twice and renders the
  // shell at 1/scale of the window — a dead band under it on any display where
  // the scale clamps above 1. It reads like the fix rather than the bug, and
  // was written that way once already.
  assert.match(layoutCss, /^\s*height:\s*100dvh;$/m);
  assert.doesNotMatch(layoutCss, /height:\s*calc\(100dvh\s*\/\s*var\(--sh-ws-scale\)\)/);
});

test("the shell width still divides by the zoom scale by hand", () => {
  // The mirror of the rule above: percentages get no zoom compensation, so
  // this one has to divide. The pair only looks inconsistent.
  assert.match(layoutCss, /width:\s*calc\(100%\s*\/\s*var\(--sh-ws-scale\)\)/);
});

test("no transform fallback stands in for zoom", () => {
  // `transform: scale()` does not affect layout, so the fallback reserved the
  // unscaled box and guaranteed the same gap it was meant to prevent. `zoom`
  // is baseline in every browser this app targets.
  assert.doesNotMatch(layoutCss, /@supports not \(zoom: 1\)/);
});
