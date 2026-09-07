// The footer's link columns. Everything here is either a real destination or
// a placeholder the anchor handler swallows — the distinction decides how the
// link is rendered, so it is worth pinning.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { footer } from "./data.ts";

const finalSource = readFileSync(
  path.join(import.meta.dirname, "sections/Final.tsx"),
  "utf8",
);

const col = (title: string) => {
  const found = footer.cols.find((c) => c.title === title);
  assert.ok(found, `${title} column exists`);
  return found!;
};

test("no account column — sign-in lives on the CTA, not the footer", () => {
  assert.equal(
    footer.cols.some((c) => c.title === "Account"),
    false,
  );
  // The one way in is still the headline CTA.
  assert.equal(footer.cta.href, "/new");
});

test("product is the changelog, about us, and the repo", () => {
  assert.deepEqual(
    col("Product").links.map((l) => l.label),
    ["Changelog", "About us", "GitHub"],
  );
});

test("the GitHub row is the only one that leaves the site", () => {
  const external = footer.cols
    .flatMap((c) => c.links)
    .filter((l) => l.href.startsWith("http"));
  assert.deepEqual(
    external.map((l) => l.href),
    ["https://github.com/Enizri/terra"],
  );
  // Opening a new tab needs `rel` alongside `target`, and only for these.
  assert.match(finalSource, /href\.startsWith\("http"\)/);
  assert.match(finalSource, /target: "_blank", rel: "noreferrer"/);
});

test("about us is the one internal row with a page behind it", () => {
  assert.equal(col("Product").links[1]!.href, "/about");
  // A route in the footer has to go through Link — an <a href="/about"> is a
  // full page reload out of the SPA.
  assert.match(finalSource, /href\.startsWith\("\/"\)/);
  assert.match(finalSource, /<Link key=\{label\} to=\{href\}>/);
});

test("every other row is a placeholder, not a broken route", () => {
  for (const link of footer.cols.flatMap((c) => c.links)) {
    if (link.href.startsWith("http") || link.href.startsWith("/")) continue;
    assert.equal(link.href, "#", `${link.label} is a placeholder`);
  }
});
