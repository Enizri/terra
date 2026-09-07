// Shape /analyze results for the three-column flow renderer (truncate to fit).

import type { DiagramEdgeView, DiagramGroupView, DiagramKind, DiagramNodeView } from "./diagramViews";
import { fileNote } from "./explain.ts";
import type { Component, TerraMap } from "./types";

/** Column: frontend | work | storage. */
const COL: Record<Component["type"], 0 | 1 | 2> = {
  frontend: 0,
  mobile: 0,
  desktop: 0,
  backend: 1,
  infrastructure: 1,
  database: 2,
};

const KIND: Record<Component["type"], DiagramKind> = {
  frontend: "frontend",
  mobile: "frontend",
  desktop: "frontend",
  backend: "backend",
  infrastructure: "service",
  database: "data",
};

/** Card colour family for a component type — the details panel reuses it so
 *  its header icon matches the card the reader just clicked. */
export function kindOf(type: Component["type"]): DiagramKind {
  return KIND[type];
}

export const MAX_NODES = 9;
export const MAX_PER_COL = 4;
/** Per-column cap when `all` is set. */
export const MAX_PER_COL_ALL = 6;
const MIN_GROUP = 2;
const GROUP_ID = "work";

const RANK: Record<Component["importance"], number> = { critical: 0, high: 1, medium: 2, low: 3 };
const byImportance = (a: Component, b: Component) =>
  RANK[a.importance] - RANK[b.importance] || (b.file_count ?? 0) - (a.file_count ?? 0);

export type DiagramView = {
  nodes: DiagramNodeView[];
  edges: DiagramEdgeView[];
  groups: DiagramGroupView[];
  /** Components omitted by caps ("+N more"). */
  hidden: Component[];
};

function dirOf(component: Component): string {
  const first = component.files[0] ?? "";
  const parts = first.replace(/\/$/, "").split("/");
  return parts.length > 1 ? `${parts[0]}/` : first;
}

/** Components this diagram draws as cards.
 *
 * Nesting only reads as nesting inside one column, so a child the map filed
 * under another column (a database under the web app, say) is promoted rather
 * than dropped. And a hierarchy that leaves fewer than two roots is flattened
 * outright: one card is not a map of anything.
 */
export function topLevel(components: Component[]): Component[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const roots = components.filter((c) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    return !parent || parent.id === c.id || COL[parent.type] !== COL[c.type];
  });
  return roots.length < 2 && components.length > 1 ? components : roots;
}

export function toDiagram(map: TerraMap, opts: { all?: boolean } = {}): DiagramView {
  const top = topLevel(map.components);

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
        // …and how much of the repository sits behind it, so the footer says
        // both where to look and how big the thing is.
        meta: fileNote(c),
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
