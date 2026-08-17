/** Architecture map feature — diagram, types, search. */
export type { TerraMap, Project, Component, Relationship } from "./types.ts";
export { toDiagram, MAX_NODES, MAX_PER_COL, MAX_PER_COL_ALL } from "./toDiagram.ts";
export { matchComponents } from "./search.ts";
export { matchSpan, topLevelId, pathTokens } from "./spanMatch.ts";
export { default as RepoDiagram } from "./RepoDiagram.tsx";
export { default as DetailsPanel } from "./DetailsPanel.tsx";
export type {
  DiagramEdgeView,
  DiagramGroupView,
  DiagramKind,
  DiagramNodeView,
} from "./diagramViews.ts";
