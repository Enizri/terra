// The nav pill is worn by pages with opposite grounds — cream on the landing,
// near-black on /about. What breaks when it moves is the cascade, not the
// markup: `tokens.css` sets `.sh-root a { color: inherit }`, a class *and* a
// type, so every unqualified colour in here silently loses to whatever the
// page's own colour happens to be. That is how the pill went cream-on-white.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

const css = read("site-nav.css");
const nav = read("SiteNav.tsx");

test("the pill names its own ink, and outranks `.sh-root a`", () => {
  const pill = css.slice(css.indexOf(".sh-nav__pill {"));
  assert.ok(
    pill.slice(0, pill.indexOf("\n}")).includes("color: #141510"),
    "the pill block names its own ink",
  );
  for (const rule of [".sh-nav__logo", ".sh-nav__link", ".sh-nav__link:hover"]) {
    const qualified = `.sh-root ${rule} {`;
    assert.ok(css.includes(qualified), `${rule} must be qualified with .sh-root`);
  }
});

test("a destination that is not a fragment goes through Link", () => {
  // An <a href="/about"> inside the SPA is a full page reload, and a `#href`
  // on a page without the landing's glide handler is a dead link. One rule
  // decides both, so it is the one worth pinning.
  assert.match(nav, /href\.startsWith\("#"\)/);
  assert.match(nav, /<Link \{\.\.\.props\} to=\{href\}>/);
});

test("the landing no longer carries its own copy of the nav skin", () => {
  const foundations = read("../../routes/landing/styles/foundations.css");
  assert.doesNotMatch(foundations, /\.sh-nav/);
  assert.doesNotMatch(foundations, /\.sh-btn--nav/);
});
