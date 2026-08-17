/** View-model shapes for the repo diagram — shared by layout logic and the React renderer. */

export type DiagramKind = "frontend" | "backend" | "data" | "service";

export type DiagramNodeView = {
  id: string;
  label: string;
  purpose: string;
  hint: string;
  kind: DiagramKind;
  /** Flow column: 0 entry, 1 work, 2 storage. */
  col: 0 | 1 | 2;
  row: number;
  group?: string;
  tech?: string[];
};

export type DiagramEdgeView = {
  from: string;
  to: string;
  label?: string;
  /** Right→left edge: route forwards, reverse arrowhead. */
  back?: boolean;
};

export type DiagramGroupView = { id: string; title: string; hint: string; col: number };
