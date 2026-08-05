import assert from "node:assert/strict";
import test from "node:test";
import { MAX_NODES, MAX_PER_COL, MAX_PER_COL_ALL, toDiagram } from "./toDiagram.ts";
import type { Component, TerraMap } from "./types.ts";
import memos from "../data/memos.map.json" with { type: "json" };

const golden = memos as TerraMap;

function check(view: ReturnType<typeof toDiagram>, all = false) {
  const ids = new Set(view.nodes.map((n) => n.id));
  // A dangling id would route an arrow from the canvas origin.
  for (const e of view.edges) {
    assert.ok(ids.has(e.from), `edge from ${e.from} has no card`);
    assert.ok(ids.has(e.to), `edge to ${e.to} has no card`);
  }
  for (const col of [0, 1, 2]) {
    const inCol = view.nodes.filter((n) => n.col === col);
    assert.ok(inCol.length <= (all ? MAX_PER_COL_ALL : MAX_PER_COL), `column ${col} overflows`);
    // Rows are the stacking order — dense and unique, or the router's
    // "adjacent row" case misfires.
    assert.deepEqual(
      inCol.map((n) => n.row).sort((a, b) => a - b),
      inCol.map((_, i) => i),
    );
  }
  if (!all) assert.ok(view.nodes.length <= MAX_NODES);
}

test("draws the memos golden map", () => {
  const view = toDiagram(golden);
  check(view);

  const ids = new Set(golden.components.map((c) => c.id));
  const top = golden.components.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  // Nothing top-level vanishes silently: it is either a card or in `hidden`.
  assert.equal(view.nodes.length + view.hidden.length, top.length);

  // The flow reads left→right: app, work, storage.
  assert.equal(view.nodes.find((n) => n.id === "web")!.col, 0);
  assert.equal(view.nodes.find((n) => n.id === "api")!.col, 1);
  assert.equal(view.nodes.find((n) => n.id === "data")!.col, 2);
  // Infrastructure shares the middle column, in the Security colour — it is
  // below the cap here, so look at the expanded view.
  const runtime = toDiagram(golden, { all: true }).nodes.find((n) => n.id === "runtime")!;
  assert.equal(runtime.col, 1);
  assert.equal(runtime.kind, "service");
  // The middle column is boxed, and everything in it says so.
  assert.equal(view.groups.length, 1);
  for (const n of view.nodes.filter((n) => n.col === 1)) {
    assert.equal(n.group, view.groups[0].id);
  }
  // Children are never cards — the details panel owns them.
  assert.ok(!view.nodes.some((n) => n.id.includes(".")));
});

test("`all` lifts the caps", () => {
  const view = toDiagram(golden, { all: true });
  check(view, true);
  assert.ok(view.nodes.length > toDiagram(golden).nodes.length);
});

test("an edge pointing back up the flow is flagged, not dropped", () => {
  const map: TerraMap = {
    project: golden.project,
    components: [
      { id: "ui", parent_id: null, name: "UI", purpose: "", importance: "critical", type: "frontend", files: [] },
      { id: "db", parent_id: null, name: "DB", purpose: "", importance: "high", type: "database", files: [] },
    ] as Component[],
    relationships: [{ from: "db", to: "ui", type: "pushes_to", because: [] }],
    suggested_questions: [],
  };
  const view = toDiagram(map);
  check(view);
  assert.equal(view.edges.length, 1);
  assert.equal(view.edges[0].back, true);
  // Two cards is not a stack — no box.
  assert.equal(view.groups.length, 0);
});

test("an oversized map keeps the important cards and reports the rest", () => {
  const big: Component[] = Array.from({ length: 20 }, (_, i) => ({
    id: `b${i}`,
    parent_id: null,
    name: `B${i}`,
    purpose: "",
    importance: i === 0 ? "critical" : "medium",
    type: "backend",
    files: [],
  }));
  const view = toDiagram({ ...golden, components: big, relationships: [] });
  check(view);
  assert.equal(view.nodes.length + view.hidden.length, big.length);
  // The critical one is never the card that gets cut.
  assert.ok(view.nodes.some((n) => n.id === "b0"));
});
