// The details panel is the one place a non-engineer reads the map in words, so
// the wording rules are pinned here against the golden map rather than against
// toy data — real `because` strings and real file lists are what they have to
// survive.
import assert from "node:assert/strict";
import test from "node:test";
import {
  childrenOf,
  connectionsOf,
  drawnAncestor,
  fileNote,
  filesSummary,
  importanceLabel,
  layerLabel,
  parentOf,
  phraseFor,
  summarizeFiles,
} from "./explain.ts";
import type { Component, TerraMap } from "./types.ts";
import memos from "../../data/memos.map.json" with { type: "json" };

const golden = memos as TerraMap;

const sentence = (c: ReturnType<typeof connectionsOf>[number]) =>
  [c.from.name, c.verb, c.to.name, c.tail].filter(Boolean).join(" ");

test("every relationship in the golden map reads as a sentence", () => {
  for (const rel of golden.relationships) {
    const conn = connectionsOf(golden, rel.from).find(
      (c) => c.key === `${rel.from}-${rel.to}-${rel.type}`,
    );
    assert.ok(conn, `${rel.type} produced no connection`);
    // No enum leaks into the sentence: `reads_writes` never reaches the reader.
    assert.doesNotMatch(sentence(conn), /_/);
    assert.ok(conn.from.name && conn.to.name, "both ends are named, not id'd");
  }
});

test("the wording is the plain-language one, both ways down the edge", () => {
  const fromApi = connectionsOf(golden, "api").find((c) => c.otherId === "auth")!;
  assert.equal(sentence(fromApi), "API Layer is protected by Authentication & Identity");
  assert.equal(fromApi.outgoing, true);

  // The same edge read from the other end keeps the same sentence, and only
  // the "which end do I link" answer flips.
  const fromAuth = connectionsOf(golden, "auth").find((c) => c.otherId === "api")!;
  assert.equal(sentence(fromAuth), sentence(fromApi));
  assert.equal(fromAuth.outgoing, false);
  assert.equal(fromAuth.otherId, "api");
});

test("outgoing connections come first", () => {
  const conns = connectionsOf(golden, "memos");
  const flip = conns.findIndex((c) => !c.outgoing);
  assert.ok(flip > 0, "memo system has both directions");
  assert.ok(conns.slice(flip).every((c) => !c.outgoing));
});

test("an unmapped relationship type still reads as words", () => {
  assert.equal(phraseFor("data_syncs_with").verb, "data syncs with");
  assert.equal(phraseFor("").verb, "connects to");
});

test("self-edges are not connections", () => {
  const map: TerraMap = {
    ...golden,
    relationships: [{ from: "api", to: "api", type: "calls", because: [] }],
  };
  assert.deepEqual(connectionsOf(map, "api"), []);
});

test("files group under the folder they share", () => {
  const memoSystem = golden.components.find((c) => c.id === "memos")!;
  const groups = summarizeFiles(memoSystem.files);

  const api = groups.find((g) => g.dir === "server/router/api/v1")!;
  assert.equal(api.items.length, 3);
  assert.ok(api.items.every((i) => !i.folder));
  // A whole directory keeps its slash so the panel can say so out loud.
  const markdown = groups.find((g) => g.dir === "internal")!;
  assert.deepEqual(markdown.items, [
    { name: "markdown/", path: "internal/markdown/", folder: true },
  ]);
  assert.equal(filesSummary(groups), "3 files and 2 whole folders");
});

test("a single whole folder is summarized as one", () => {
  const groups = summarizeFiles(["web/src/", "web/src/", " "]);
  assert.equal(groups.length, 1);
  assert.equal(filesSummary(groups), "1 whole folder");
});

test("the card footnote prefers the counted size of the part", () => {
  const web = golden.components.find((c) => c.id === "web")!;
  assert.equal(fileNote(web), "530 files");
  // No count from the analyzer: fall back to how many places were cited.
  const timeline = golden.components.find((c) => c.id === "web.timeline")!;
  assert.equal(fileNote(timeline), "5 places");
  const markdown = golden.components.find((c) => c.id === "memos.markdown")!;
  assert.equal(fileNote(markdown), "");
});

test("nesting reads both ways", () => {
  assert.deepEqual(
    childrenOf(golden.components, "web").map((c) => c.id),
    ["web.editor", "web.timeline", "web.settings"],
  );
  assert.equal(parentOf(golden.components, "web.editor")!.id, "web");
  assert.equal(parentOf(golden.components, "web"), null);
});

test("a component the diagram never drew lights up its nearest drawn ancestor", () => {
  const drawn = new Set(["web", "api", "data"]);
  assert.equal(drawnAncestor(golden.components, drawn, "web.editor"), "web");
  assert.equal(drawnAncestor(golden.components, drawn, "api"), "api");
  assert.equal(drawnAncestor(golden.components, drawn, "runtime"), null);
  assert.equal(drawnAncestor(golden.components, drawn, null), null);
});

test("a parent cycle cannot hang the walk", () => {
  const looped: Component[] = [
    { id: "a", parent_id: "b", name: "A", purpose: "", importance: "low", type: "backend", files: [] },
    { id: "b", parent_id: "a", name: "B", purpose: "", importance: "low", type: "backend", files: [] },
  ];
  assert.equal(drawnAncestor(looped, new Set(["c"]), "a"), null);
});

test("layers and importance are named in words a reader knows", () => {
  assert.equal(layerLabel("database"), "Storage");
  assert.equal(layerLabel("frontend"), "Screens");
  assert.equal(importanceLabel("critical"), "Core");
});
