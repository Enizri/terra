import type { Component } from "../map/types";

/**
 * A node in the rail's Files tree. `owners` are the component ids that listed
 * this path — clicking a row selects the first one, which is what puts the
 * card and its details on screen.
 */
export type FileNode = {
  name: string;
  /** Full path, no trailing slash — also the React key. */
  path: string;
  kind: "dir" | "file";
  owners: string[];
  children: FileNode[];
};

type Draft = { node: FileNode; children: Map<string, Draft> };

function insert(level: Map<string, Draft>, rawPath: string, owner: string) {
  // The analyzer lists whole folders too ("internal/markdown/"), so a trailing
  // slash is the only signal that a leaf is a directory rather than a file.
  const isDir = rawPath.endsWith("/");
  const parts = rawPath.split("/").filter(Boolean);
  let cursor = level;
  let prefix = "";

  parts.forEach((part, i) => {
    prefix = prefix ? `${prefix}/${part}` : part;
    const last = i === parts.length - 1;
    const kind: FileNode["kind"] = last && !isDir ? "file" : "dir";

    let entry = cursor.get(part);
    if (!entry) {
      entry = {
        node: { name: part, path: prefix, kind, owners: [], children: [] },
        children: new Map(),
      };
      cursor.set(part, entry);
    }
    if (!entry.node.owners.includes(owner)) entry.node.owners.push(owner);
    cursor = entry.children;
  });
}

function finalize(level: Map<string, Draft>): FileNode[] {
  return [...level.values()]
    .map((entry) => ({ ...entry.node, children: finalize(entry.children) }))
    .sort((a, b) => {
      const aDir = a.children.length > 0 || a.kind === "dir";
      const bDir = b.children.length > 0 || b.kind === "dir";
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Every file the map mentions, folded into one tree. */
export function buildFileTree(components: Component[]): FileNode[] {
  const root = new Map<string, Draft>();
  for (const c of components) {
    for (const file of c.files) {
      if (file.trim()) insert(root, file.trim(), c.id);
    }
  }
  return finalize(root);
}

/** Leaves only: a listed file, or a folder the analyzer listed whole. */
export function countLeaves(nodes: FileNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + (n.children.length === 0 ? 1 : countLeaves(n.children)),
    0,
  );
}
