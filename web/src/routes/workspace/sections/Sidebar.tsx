import { useMemo, useState, type ReactNode } from "react";
import type { TerraMap } from "../../../shared/map/types";
import { buildFileTree, countLeaves, type FileNode } from "../../../shared/fileTree";
import type { HistoryEntry } from "../history";
import { ChevronIcon } from "../icons";

/** One rail section: the header is the toggle, the body is what it hides. */
function RailSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`sh-ws__rail-section${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="sh-ws__rail-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        {count !== undefined && <em className="sh-ws__rail-count">{count}</em>}
        <ChevronIcon />
      </button>
      {open && <div className="sh-ws__rail-body">{children}</div>}
    </section>
  );
}

/** A folder row that hides its children, or a leaf that selects its component. */
function FileRow({ node, onSelect }: { node: FileNode; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const owner = node.owners[0];

  if (node.children.length === 0) {
    return (
      <li className="sh-ws__file">
        <button
          type="button"
          className={`sh-ws__file-row is-${node.kind}`}
          title={node.path}
          disabled={!owner}
          onClick={() => owner && onSelect(owner)}
        >
          <span className="sh-ws__file-name">{node.name}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="sh-ws__file">
      <button
        type="button"
        className="sh-ws__file-row is-dir"
        aria-expanded={open}
        title={node.path}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`sh-ws__file-chev${open ? " is-open" : ""}`} aria-hidden>
          <ChevronIcon />
        </span>
        <span className="sh-ws__file-name">{node.name}</span>
      </button>
      {open && (
        <ul className="sh-ws__tree sh-ws__tree--nested">
          {node.children.map((child) => (
            <FileRow key={child.path} node={child} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The left rail: the mapped repo's files, and every analysis the store holds. */
export function Sidebar({
  map,
  history,
  onSelect,
  onOpen,
  busy,
}: {
  map: TerraMap | null;
  history: HistoryEntry[];
  onSelect: (id: string) => void;
  /** Load a stored analysis's saved map — no pipeline re-run. */
  onOpen: (entry: HistoryEntry) => void;
  busy: boolean;
}) {
  const tree = useMemo(() => (map ? buildFileTree(map.components) : []), [map]);
  const fileCount = useMemo(() => countLeaves(tree), [tree]);
  const current = map?.project.repository_url ?? null;

  return (
    <aside className="sh-ws__rail">
      <RailSection title="Files" count={map ? fileCount : undefined}>
        {tree.length === 0 ? (
          <p className="sh-ws__rail-empty">Nothing here yet — drop a repo to fill this.</p>
        ) : (
          <ul className="sh-ws__tree">
            {tree.map((node) => (
              <FileRow key={node.path} node={node} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </RailSection>
      <RailSection title="History" count={history.length || undefined}>
        {history.length === 0 ? (
          <p className="sh-ws__rail-empty">No stored maps yet.</p>
        ) : (
          <ul className="sh-ws__history">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className={`sh-ws__history-row${h.repoUrl === current ? " is-current" : ""}`}
                  title={h.repoUrl}
                  disabled={busy || h.repoUrl === current}
                  onClick={() => onOpen(h)}
                >
                  <b>{h.name}</b>
                  <em>{new Date(h.scannedAt).toLocaleDateString()}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </aside>
  );
}
