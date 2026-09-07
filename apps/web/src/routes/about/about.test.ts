// Keep the static About page wired into client-side navigation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) =>
  readFileSync(path.join(import.meta.dirname, file), "utf8");

const page = read("AboutPage.tsx");

test("the page is reachable", () => {
  const app = readFileSync(
    path.join(import.meta.dirname, "../../app/App.tsx"),
    "utf8",
  );
  assert.match(app, /path="\/about" element={<AboutPage \/>}/);
});

test("every destination on the page is a route, not a reloading anchor", () => {
  // The landing's eased anchor handler is not mounted here, so a `#` href
  // would be a dead link and a bare <a href="/new"> a full page reload.
  assert.doesNotMatch(page, /href="/);
  assert.doesNotMatch(page, /"#/);
  assert.match(page, /<Link className="ab-cta" to="\/new">/);
});
