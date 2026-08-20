import assert from "node:assert/strict";
import test from "node:test";
import { diagramEdges, diagramNodes } from "./data.ts";
import {
  flowBoxes,
  interiorInsideShell,
  layoutInterior,
  MAX_LABELS,
  MAX_SOLID,
  routeOrtho,
  SOLID_FLOATS,
  type InteriorFrame,
} from "./globeInterior.ts";
import { INSTANCE_FLOATS } from "./globeLayout.ts";

const SIZE = 560;
const solids = new Float32Array(MAX_SOLID * SOLID_FLOATS);
const labels = new Float32Array(MAX_LABELS * INSTANCE_FLOATS);

const frame = (over: Partial<InteriorFrame> = {}): InteriorFrame => ({
  size: SIZE,
  pointerX: -1e4,
  pointerY: -1e4,
  yaw: 0,
  pitch: 0,
  presence: 1,
  t: 3,
  reduced: false,
  ...over,
});

test("interior radius sits inside the glyph shell", () => {
  assert.ok(interiorInsideShell());
});

test("layout emits all six diagram nodes", () => {
  const out = layoutInterior(frame({ pointerX: SIZE / 2, pointerY: SIZE / 2 }), solids, labels);
  assert.equal(out.nodes.length, diagramNodes.length);
  for (const node of diagramNodes) {
    assert.ok(out.nodes.some((n) => n.id === node.id), `missing ${node.id}`);
  }
});

test("columns read left to right like the Terra map", () => {
  const out = layoutInterior(frame({ pointerX: SIZE / 2, pointerY: SIZE / 2, yaw: 0 }), solids, labels);
  const web = out.nodes.find((n) => n.id === "web")!;
  const api = out.nodes.find((n) => n.id === "api")!;
  const db = out.nodes.find((n) => n.id === "db")!;
  assert.ok(web.sx < api.sx, `web (${web.sx}) should be left of api (${api.sx})`);
  assert.ok(api.sx < db.sx, `api (${api.sx}) should be left of db (${db.sx})`);
});

test("backend stack is top to bottom", () => {
  const out = layoutInterior(frame({ pointerX: SIZE / 2, pointerY: SIZE / 2, yaw: 0 }), solids, labels);
  const auth = out.nodes.find((n) => n.id === "auth")!;
  const api = out.nodes.find((n) => n.id === "api")!;
  const memos = out.nodes.find((n) => n.id === "memos")!;
  const files = out.nodes.find((n) => n.id === "files")!;
  assert.ok(auth.sy < api.sy, "auth above api");
  assert.ok(api.sy < memos.sy, "api above memos");
  assert.ok(memos.sy < files.sy, "memos above files");
});

test("with the hole open the map stays strongly readable", () => {
  const out = layoutInterior(frame(), solids, labels);
  for (const n of out.nodes) {
    // Unlinked nodes dim, but the active cluster stays bright.
    assert.ok(n.alpha > 0.2, `${n.id} should still be visible, got ${n.alpha}`);
  }
  const bright = out.nodes.filter((n) => n.alpha > 0.5);
  assert.ok(bright.length >= 2, "active node and neighbors should read clearly");
});

test("pointer on a projected node lights it and its neighbors", () => {
  const probe = layoutInterior(frame({ pointerX: SIZE / 2, pointerY: SIZE / 2 }), solids, labels);
  const target = probe.nodes.find((n) => n.id === "api") ?? probe.nodes[0];
  const lit = layoutInterior(
    frame({ pointerX: target.sx, pointerY: target.sy }),
    solids,
    labels,
  );
  const hot = lit.nodes.find((n) => n.id === target.id)!;
  assert.ok(hot.alpha > 0.7, `node under cursor should be hot, got ${hot.alpha}`);

  const neighborIds = new Set<string>();
  for (const e of diagramEdges) {
    if (e.from === target.id) neighborIds.add(e.to);
    if (e.to === target.id) neighborIds.add(e.from);
  }
  const neighbor = lit.nodes.find((n) => neighborIds.has(n.id))!;
  const unlinked = lit.nodes.find((n) => n.id !== target.id && !neighborIds.has(n.id))!;
  assert.ok(neighbor, "api should have neighbors");
  assert.ok(unlinked, "some node should be unlinked");
  assert.ok(
    neighbor.alpha > unlinked.alpha,
    `neighbor ${neighbor.id} (${neighbor.alpha}) should beat unlinked ${unlinked.id} (${unlinked.alpha})`,
  );

  assert.ok(lit.solids > 0);
  assert.ok(lit.solids <= MAX_SOLID);
  assert.ok(lit.labels > 30 && lit.labels <= MAX_LABELS);
});

test("edges match the marketing diagram", () => {
  const out = layoutInterior(frame({ pointerX: SIZE / 2, pointerY: SIZE / 2 }), solids, labels);
  const ids = new Set(out.nodes.map((n) => n.id));
  for (const e of diagramEdges) {
    assert.ok(ids.has(e.from), e.from);
    assert.ok(ids.has(e.to), e.to);
  }
  assert.equal(diagramEdges.length, 6);
});

test("yaw moves projected nodes with the globe", () => {
  const a = layoutInterior(frame({ pointerX: SIZE / 2, pointerY: SIZE / 2, yaw: 0 }), solids, labels);
  const b = layoutInterior(
    frame({ pointerX: SIZE / 2, pointerY: SIZE / 2, yaw: 0.4 }),
    solids,
    labels,
  );
  let moved = 0;
  for (const na of a.nodes) {
    const nb = b.nodes.find((n) => n.id === na.id)!;
    if (Math.hypot(nb.sx - na.sx, nb.sy - na.sy) > 1) moved++;
  }
  assert.ok(moved >= 4, "most nodes should shift when the globe yaws");
});

test("reduced motion and zero presence skip the interior", () => {
  assert.deepEqual(layoutInterior(frame({ reduced: true, presence: 1 }), solids, labels), {
    solids: 0,
    labels: 0,
    nodes: [],
  });
  assert.deepEqual(layoutInterior(frame({ presence: 0 }), solids, labels), {
    solids: 0,
    labels: 0,
    nodes: [],
  });
});

test("column hop route has an elbow; adjacent same-col is vertical", () => {
  const boxes = flowBoxes(1);
  const web = diagramNodes.find((n) => n.id === "web")!;
  const api = diagramNodes.find((n) => n.id === "api")!;
  const hop = routeOrtho(web, api, boxes.get("web")!, boxes.get("api")!);
  assert.ok(hop);
  assert.ok(hop!.pts.length >= 3, `column hop should elbow, got ${hop!.pts.length} pts`);
  const xs = new Set(hop!.pts.map((p) => Math.round(p.x * 10) / 10));
  const ys = new Set(hop!.pts.map((p) => Math.round(p.y * 10) / 10));
  assert.ok(xs.size >= 2 && ys.size >= 2, "elbow spans both axes");

  const auth = diagramNodes.find((n) => n.id === "auth")!;
  // auth row 0, api row 1 — adjacent same column
  const vert = routeOrtho(auth, api, boxes.get("auth")!, boxes.get("api")!);
  assert.ok(vert);
  assert.equal(vert!.pts.length, 2);
  assert.equal(Math.round(vert!.pts[0].x), Math.round(vert!.pts[1].x));
  assert.notEqual(vert!.pts[0].y, vert!.pts[1].y);
});

test("non-adjacent same-column detour goes left", () => {
  const boxes = flowBoxes(1);
  const auth = diagramNodes.find((n) => n.id === "auth")!;
  const files = diagramNodes.find((n) => n.id === "files")!;
  const detour = routeOrtho(auth, files, boxes.get("auth")!, boxes.get("files")!);
  assert.ok(detour);
  assert.ok(detour!.pts.length >= 3);
  const minX = Math.min(...detour!.pts.map((p) => p.x));
  assert.ok(minX < boxes.get("auth")!.x, "detour should leave the left face");
});
