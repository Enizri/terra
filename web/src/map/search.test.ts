import assert from "node:assert/strict";
import test from "node:test";
import { matchComponents } from "./search.ts";
import type { Component } from "./types.ts";

const comp = (over: Partial<Component> & { id: string; name: string }): Component => ({
  parent_id: null,
  purpose: "",
  importance: "medium",
  type: "backend",
  files: [],
  ...over,
});

const map: Component[] = [
  comp({ id: "web", name: "Web Interface", type: "frontend", tech: ["React"], files: ["web/src/"] }),
  comp({ id: "auth", name: "Authentication", files: ["server/auth/login.go"] }),
  comp({ id: "store", name: "Data Storage", purpose: "Persists memos for the auth layer" }),
];

test("an empty query matches nothing", () => {
  assert.deepEqual(matchComponents(map, ""), []);
  assert.deepEqual(matchComponents(map, "   "), []);
});

test("name matches are case-insensitive and rank first", () => {
  // "auth" is in Authentication's name and in Data Storage's purpose.
  assert.deepEqual(
    matchComponents(map, "AUTH").map((c) => c.id),
    ["auth", "store"],
  );
});

test("a name prefix outranks a name substring", () => {
  const both = [comp({ id: "a", name: "User Data" }), comp({ id: "b", name: "Data Storage" })];
  assert.deepEqual(
    matchComponents(both, "data").map((c) => c.id),
    ["b", "a"],
  );
});

test("file paths and tech are searchable", () => {
  assert.deepEqual(
    matchComponents(map, "login.go").map((c) => c.id),
    ["auth"],
  );
  assert.deepEqual(
    matchComponents(map, "react").map((c) => c.id),
    ["web"],
  );
});

test("results are capped", () => {
  const many = Array.from({ length: 20 }, (_, i) => comp({ id: `c${i}`, name: `Service ${i}` }));
  assert.equal(matchComponents(many, "service").length, 8);
  assert.equal(matchComponents(many, "service", 3).length, 3);
});
