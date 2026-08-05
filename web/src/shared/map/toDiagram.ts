// A real /analyze result, shaped for the hero's three-column flow renderer.
//
// The renderer is deliberately not general: three columns, one group box, and
// a router with three cases. So the map is truncated to fit rather than the
// renderer generalised — the cost is that low-importance components are hidden
// until the caller asks for `all`.

import type { DiagramEdgeView, DiagramGroupView, DiagramKind, DiagramNodeView } from "./RepoDiagram";
import type { Component, TerraMap } from "./types";

/** frontend on the left, the work in the middle, storage on the right. */
const COL: Record<Component["type"], 0 | 1 | 2> = {
  frontend: 0,
  backend: 1,
  infrastructure: 1,
  database: 2,
};

/** Reuses the four card colours the landing already teaches. */
const KIND: Record<Component["type"], DiagramKind> = {
  frontend: "frontend",
  backend: "backend",
  infrastructure: "service",
  database: "data",
};

/** Past this the cards shrink below readable and the stack outgrows the window. */
export const MAX_NODES = 9;
export const MAX_PER_COL = 4;
/** `all` lifts the total, but a column taller than this leaves the canvas. */
export const MAX_PER_COL_ALL = 6;
/** The middle column only earns its box once there is a stack to box. */
const MIN_GROUP = 2;
const GROUP_ID = "work";

/** Most important / biggest first — the card order in every column. */
const RANK: Record<Component["importance"], number> = { critical: 0, high: 1, medium: 2 };
const byImportance = (a: Component, b: Component) =>
  RANK[a.importance] - RANK[b.importance] || (b.file_count ?? 0) - (a.file_count ?? 0);

export type DiagramView = {
  nodes: DiagramNodeView[];
  edges: DiagramEdgeView[];
  groups: DiagramGroupView[];
  /** Top-level components the caps left out — the map bar's "+N more". */
  hidden: Component[];
};

/** Directory a component lives in, for the group box's subtitle. */
function dirOf(c: Component): string {
  const first = c.files[0] ?? "";
  const parts = first.replace(/\/$/, "").split("/");
  return parts.length > 1 ? `${parts[0]}/` : first;
}

export function toDiagram(map: TerraMap, opts: { all?: boolean } = {}): DiagramView {
  const ids = new Set(map.components.map((c) => c.id));
  // Same rule as layoutMap: a parent_id nothing resolves to is drawn top-level.
  const top = map.components.filter((c) => !c.parent_id || !ids.has(c.parent_id));

  const perCol = opts.all ? MAX_PER_COL_ALL : MAX_PER_COL;
  const total = opts.all ? Infinity : MAX_NODES;

  const cols: Component[][] = [[], [], []];
  for (const c of top) cols[COL[c.type]].push(c);
  for (const col of cols) col.sort(byImportance);

  const hidden: Component[] = [];
  const kept = cols.map((col) => {
    hidden.push(...col.slice(perCol));
    return col.slice(0, perCol);
  });

  // Still over budget: give up the least important cards, wherever they sit.
  let shown = kept.flat();
  if (shown.length > total) {
    const dropped = [...shown].sort(byImportance).slice(total);
    hidden.push(...dropped);
    const cut = new Set(dropped.map((c) => c.id));
    shown = shown.filter((c) => !cut.has(c.id));
  }

  const middle = shown.filter((c) => COL[c.type] === 1);
  const grouped = middle.length >= MIN_GROUP;

  const nodes: DiagramNodeView[] = [0, 1, 2].flatMap((col) =>
    shown
      .filter((c) => COL[c.type] === col)
      .map((c, row) => ({
        id: c.id,
        label: c.name,
        purpose: c.purpose,
        // The hint slot is a code path — the card's evidence at a glance.
        hint: c.files[0] ?? "",
        kind: KIND[c.type],
        tech: c.tech,
        col: col as 0 | 1 | 2,
        row,
        group: col === 1 && grouped ? GROUP_ID : undefined,
      })),
  );

  const groups: DiagramGroupView[] = grouped
    ? [
        {
          id: GROUP_ID,
          title: "Backend",
          hint: [...new Set(middle.map(dirOf))].filter(Boolean).slice(0, 2).join(" · "),
          col: 1,
        },
      ]
    : [];

  const drawn = new Set(shown.map((c) => c.id));
  const colOf = Object.fromEntries(shown.map((c) => [c.id, COL[c.type]]));
  const edges: DiagramEdgeView[] = map.relationships
    .filter((r) => r.from !== r.to && drawn.has(r.from) && drawn.has(r.to))
    .map((r) => ({
      from: r.from,
      to: r.to,
      label: r.type.replace(/_/g, " "),
      // Right→left in the flow: the router only knows how to go forwards.
      back: colOf[r.to] < colOf[r.from],
    }));

  return { nodes, edges, groups, hidden };
}
