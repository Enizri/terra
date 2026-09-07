/** Plain-language readings of a Terra map.
 *
 * The wire shape is engineer-shaped on purpose — a relationship is
 * `{type: "reads_writes"}` and a component's evidence is a flat list of paths.
 * That is the right thing to store and the wrong thing to show: a reader who
 * does not write software learns nothing from `reads_writes → Data Storage` or
 * from twelve file paths in a column.
 *
 * Everything here turns that record into sentences and groups. It lives beside
 * the panel rather than inside it so the wording is testable without a DOM,
 * and so the vocabulary is in one place when the analyzer starts emitting a
 * relationship type nobody has written a phrase for yet.
 */

import type { Component, Relationship, TerraMap } from "./types";

/** What a reader would call this kind of part, not what the schema calls it. */
const LAYER: Record<Component["type"], string> = {
  frontend: "Screens",
  mobile: "Mobile app",
  desktop: "Desktop app",
  backend: "Logic",
  infrastructure: "Infrastructure",
  database: "Storage",
};

export function layerLabel(type: Component["type"]): string {
  return LAYER[type] ?? type;
}

/** Importance as a badge word and as the sentence behind it. */
const IMPORTANCE: Record<Component["importance"], { label: string; line: string }> = {
  critical: { label: "Core", line: "Core part — the product does not work without it." },
  high: { label: "Major", line: "Major part — most of the product leans on it." },
  medium: { label: "Supporting", line: "Supporting part — useful, not load-bearing." },
  low: { label: "Minor", line: "Minor part — a small corner of the system." },
};

export function importanceLabel(importance: Component["importance"]): string {
  return IMPORTANCE[importance]?.label ?? importance;
}

export function importanceLine(importance: Component["importance"]): string {
  return IMPORTANCE[importance]?.line ?? "";
}

/** `{subject} {verb} {object}{ tail}` — one phrase reads in both directions,
 *  because both ends of an edge are singular nouns. */
type Phrase = { verb: string; tail?: string };

const PHRASE: Record<string, Phrase> = {
  calls: { verb: "sends requests to" },
  requests: { verb: "sends requests to" },
  exposes: { verb: "publishes", tail: "to the outside world" },
  serves: { verb: "serves" },
  hosts: { verb: "runs" },
  runs: { verb: "runs" },
  initializes: { verb: "starts up" },
  configures: { verb: "sets up" },
  guarded_by: { verb: "is protected by" },
  guards: { verb: "protects" },
  authenticates: { verb: "checks who is signed in with" },
  authorizes: { verb: "checks permissions with" },
  reads_writes: { verb: "keeps its data in" },
  writes: { verb: "saves data into" },
  reads: { verb: "reads from" },
  stores: { verb: "stores data in" },
  persists: { verb: "stores data in" },
  queries: { verb: "looks things up in" },
  uses: { verb: "relies on" },
  depends_on: { verb: "relies on" },
  extends: { verb: "builds on" },
  implements: { verb: "implements" },
  contains: { verb: "contains" },
  owns: { verb: "owns" },
  notifies: { verb: "tells", tail: "when something happens" },
  publishes: { verb: "sends events to" },
  subscribes: { verb: "listens to" },
  triggers: { verb: "sets off" },
  renders: { verb: "draws" },
  validates: { verb: "checks" },
  upgraded_by: { verb: "is kept up to date by" },
  generates: { verb: "generates" },
  imports: { verb: "pulls code from" },
};

/** An unknown type still reads as a sentence: `data_syncs_with` → "data syncs
 *  with". Worse than a written phrase, far better than a bare enum. */
export function phraseFor(type: string): Phrase {
  return PHRASE[type] ?? { verb: type.replace(/_/g, " ").trim() || "connects to" };
}

export type Endpoint = { id: string; name: string };

export type Connection = {
  /** Stable per edge — `from`/`to`/`type`, since a pair can be joined twice. */
  key: string;
  from: Endpoint;
  to: Endpoint;
  verb: string;
  tail: string;
  /** The end that is *not* the component whose panel this is: what to link. */
  otherId: string;
  /** This component is the sentence's subject. Outgoing reads first. */
  outgoing: boolean;
  /** The map's own word for the edge, for the reader who wants the term. */
  raw: string;
  /** Files and notes the analyzer offered as proof. */
  because: string[];
};

function endpoint(components: Component[], id: string): Endpoint {
  return { id, name: components.find((c) => c.id === id)?.name ?? id };
}

/** Every edge touching `id`, as sentences. Outgoing first: what this part does
 *  is a better opening than what is done to it. */
export function connectionsOf(map: TerraMap, id: string): Connection[] {
  const touching = map.relationships.filter(
    (rel: Relationship) => rel.from !== rel.to && (rel.from === id || rel.to === id),
  );
  return touching
    .map((rel) => {
      const { verb, tail } = phraseFor(rel.type);
      return {
        key: `${rel.from}-${rel.to}-${rel.type}`,
        from: endpoint(map.components, rel.from),
        to: endpoint(map.components, rel.to),
        verb,
        tail: tail ?? "",
        otherId: rel.from === id ? rel.to : rel.from,
        outgoing: rel.from === id,
        raw: rel.type.replace(/_/g, " "),
        because: rel.because ?? [],
      };
    })
    .sort((a, b) => Number(b.outgoing) - Number(a.outgoing));
}

export type FileItem = {
  /** Leaf as shown under its folder heading; a folder keeps its slash. */
  name: string;
  /** The path exactly as the analyzer wrote it — the title/copy value. */
  path: string;
  /** The analyzer named a whole directory, not one file. */
  folder: boolean;
};

export type FileGroup = {
  /** Folder the items share; "" when they sit at the repository root. */
  dir: string;
  items: FileItem[];
};

/** Fold a component's evidence into one row per folder.
 *
 * A component's `files` is a flat mix of exact paths and whole directories, and
 * four of the five entries usually share a parent. Grouping by that parent is
 * what turns a wall of paths into "three files in `server/router/api/v1`" — the
 * exact paths are still there, one disclosure away. */
export function summarizeFiles(files: string[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  const seen = new Set<string>();

  for (const raw of files) {
    const path = raw.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);

    const folder = path.endsWith("/");
    const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts[parts.length - 1] + (folder ? "/" : "");
    const dir = parts.slice(0, -1).join("/");

    const group = groups.get(dir) ?? { dir, items: [] };
    group.items.push({ name, path, folder });
    groups.set(dir, group);
  }

  return [...groups.values()];
}

/** "5 files and 2 whole folders" — the count line above the groups. */
export function filesSummary(groups: FileGroup[]): string {
  let files = 0;
  let folders = 0;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.folder) folders += 1;
      else files += 1;
    }
  }
  const bits: string[] = [];
  if (files) bits.push(`${files} file${files === 1 ? "" : "s"}`);
  if (folders) bits.push(`${folders} whole folder${folders === 1 ? "" : "s"}`);
  return bits.join(" and ");
}

/** The card's footer note: how much code this part is, when the map counted. */
export function fileNote(component: Component): string {
  const counted = component.file_count ?? 0;
  if (counted > 1) return `${counted.toLocaleString()} files`;
  const listed = component.files.filter((f) => f.trim()).length;
  return listed > 1 ? `${listed} places` : "";
}

/** Components filed under `id` — the map's own nesting, one level down. */
export function childrenOf(components: Component[], id: string): Component[] {
  return components.filter((c) => c.parent_id === id && c.id !== id);
}

export function parentOf(components: Component[], id: string): Component | null {
  const self = components.find((c) => c.id === id);
  if (!self?.parent_id || self.parent_id === id) return null;
  return components.find((c) => c.id === self.parent_id) ?? null;
}

/** The card to light up for a component the diagram does not draw.
 *
 * Nested components (and anything the node caps left out) can still be selected
 * — from the rail, from search, from a connection link — and the map would then
 * show no selection at all. Walking up to the nearest drawn ancestor keeps the
 * canvas and the panel talking about the same place. */
export function drawnAncestor(
  components: Component[],
  drawn: ReadonlySet<string>,
  id: string | null,
): string | null {
  let cursor = id;
  const guard = new Set<string>();
  while (cursor && !drawn.has(cursor)) {
    if (guard.has(cursor)) return null;
    guard.add(cursor);
    cursor = parentOf(components, cursor)?.id ?? null;
  }
  return cursor;
}
