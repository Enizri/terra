import assert from "node:assert/strict";
import test from "node:test";
import { buildFileTree, countLeaves } from "./fileTree.ts";
import type { Component } from "../map/types.ts";

function component(id: string, files: string[]): Component {
  return {
    id,
    parent_id: null,
    name: id,
    purpose: "",
    importance: "medium",
    type: "backend",
    files,
  };
}

test("nests paths under shared folders", () => {
  const tree = buildFileTree([
    component("api", ["server/router/v1/memo.go", "server/router/v1/user.go"]),
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].name, "server");
  assert.equal(tree[0].kind, "dir");
  const v1 = tree[0].children[0].children[0];
  assert.deepEqual(
    v1.children.map((c) => c.name),
    ["memo.go", "user.go"],
  );
  assert.equal(v1.children[0].kind, "file");
});

test("a trailing slash stays a directory leaf", () => {
  const tree = buildFileTree([component("md", ["internal/markdown/"])]);
  const leaf = tree[0].children[0];
  assert.equal(leaf.name, "markdown");
  assert.equal(leaf.kind, "dir");
  assert.equal(leaf.children.length, 0);
});

test("folders sort before files and owners accumulate", () => {
  const tree = buildFileTree([
    component("a", ["main.go", "pkg/one.go"]),
    component("b", ["pkg/two.go"]),
  ]);
  assert.deepEqual(
    tree.map((n) => n.name),
    ["pkg", "main.go"],
  );
  assert.deepEqual(tree[0].owners, ["a", "b"]);
});

test("counts leaves, not folders", () => {
  const tree = buildFileTree([
    component("a", ["pkg/one.go", "pkg/two.go", "internal/markdown/"]),
  ]);
  assert.equal(countLeaves(tree), 3);
});

test("blank entries are ignored", () => {
  assert.deepEqual(buildFileTree([component("a", ["", "  "])]), []);
});
