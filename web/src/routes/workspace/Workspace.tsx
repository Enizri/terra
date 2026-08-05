import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, KeyboardEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { Component, TerraMap } from "../../shared/map/types";
import RepoDiagram from "../../shared/map/RepoDiagram";
import DetailsPanel from "../../shared/map/DetailsPanel";
import { toDiagram } from "../../shared/map/toDiagram";
import memosFixture from "../../data/memos.map.json";
import { matchComponents } from "../../shared/map/search";
import { LiveFrame, useFloatingDrag, useStreamingAskHint, type LiveSelection } from "../../shared/live";
import { useAnalyze } from "./useAnalyze";
import { useAsk, type AskMessage, type AskPart, type AskSelection } from "./useAsk";
import { renderMarkdown } from "../../shared/markdown";
import { buildFileTree, countLeaves, type FileNode } from "../../shared/fileTree";
// Owns its skin import: today terra.css only loads because App statically
// imports TerraLanding, which stops being true the moment a route is lazy.
import "../../shared/styles/tokens.css";
import "../../shared/styles/ui.css";
import "./workspace.css";

/** Selection cap — the theater's, for the same reason: keep the crumbs readable. */
const MAX_SELECTED = 3;

/** Crumb key for a picked preview element — shared so × drops the one clicked. */
const elementKey = (el: LiveSelection, i: number) =>
  `e:${el.file ?? ""}:${el.name ?? el.tag ?? i}`;

const SLUG_WORDS = ["space", "orbit", "atlas", "basin", "harbor", "meadow", "canyon", "delta"];

/** Session id for a fresh workspace: one word, one number. */
export function randomSlug() {
  const word = SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${word}-${Math.floor(Math.random() * 9000) + 1000}`;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v7M5 7.5L8 10.5l3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden className="sh-ws-drop__icon">
      <path
        d="M11 9.5h13.5l3.5 4.5H37a2.5 2.5 0 012.5 2.5v20A2.5 2.5 0 0137 39H11a2.5 2.5 0 01-2.5-2.5V12A2.5 2.5 0 0111 9.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M24 20v10M19.5 25.5L24 30l4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WorkspaceHeader({ slug, busy }: { slug: string; busy: boolean }) {
  return (
    <header className="sh-ws__head">
      <Link className="sh-ws__logo" to="/">
        <span className={`sh-terra-mark${busy ? " sh-terra-mark--spin" : ""}`} aria-hidden />
        <span>Terra</span>
      </Link>
      <span className="sh-ws__crumb">
        <b>{slug}</b>
        <em>untitled map</em>
      </span>
      <div className="sh-ws__chips">
        <span className="sh-chip is-disabled">
          <DownloadIcon /> Export JSON
        </span>
        <span className="sh-chip sh-chip--tint is-disabled">
          Share map <ArrowIcon />
        </span>
      </div>
    </header>
  );
}

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

/** A repo mapped in this session — clicking one maps it again. */
type HistoryEntry = { repoUrl: string; name: string; components: number };

function Sidebar({
  map,
  history,
  onSelect,
  onReplay,
  busy,
}: {
  map: TerraMap | null;
  history: HistoryEntry[];
  onSelect: (id: string) => void;
  onReplay: (repoUrl: string) => void;
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
          <p className="sh-ws__rail-empty">No maps in this session.</p>
        ) : (
          <ul className="sh-ws__history">
            {history.map((h) => (
              <li key={h.repoUrl}>
                <button
                  type="button"
                  className={`sh-ws__history-row${h.repoUrl === current ? " is-current" : ""}`}
                  title={h.repoUrl}
                  disabled={busy || h.repoUrl === current}
                  onClick={() => onReplay(h.repoUrl)}
                >
                  <b>{h.name}</b>
                  <em>{h.components} components</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </aside>
  );
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** One evolving line — the previous stage is replaced, never stacked. */
function StatusLine({ label, elapsed }: { label: string; elapsed: number }) {
  return (
    <div className="sh-ws__status" aria-live="polite">
      <span className="sh-terra-mark sh-terra-mark--spin sh-ws__status-mark" aria-hidden />
      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          className="sh-ws__status-label"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
      <em className="sh-ws__status-time">{clock(elapsed)}</em>
    </div>
  );
}

/**
 * Find a component by name, tech, type, file or purpose and jump to it.
 * Selecting is the whole feature — the map already dims everything else.
 */
function MapSearch({ map, onSelect }: { map: TerraMap; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const results = matchComponents(map.components, query);

  const pick = (id: string) => {
    onSelect(id);
    setQuery("");
  };

  return (
    <form
      className="sh-ws__find"
      onSubmit={(e) => {
        e.preventDefault();
        if (results.length > 0) pick(results[0].id);
      }}
    >
      <input
        className="sh-ws__find-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        placeholder="Find a component"
        aria-label="Find a component in the map"
        spellCheck={false}
      />
      {query.trim() && (
        <ul className="sh-ws__find-list">
          {results.length === 0 && <li className="sh-ws__find-empty">No component matches.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="sh-ws__find-hit" onClick={() => pick(c.id)}>
                <b>{c.name}</b>
                <em>{c.type}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Everything the old ResultCard said, compressed into one strip above the map. */
function MapStage({
  map,
  selectedIds,
  onSelect,
  onElements,
}: {
  map: TerraMap;
  selectedIds: string[];
  /** `additive` (shift/⌘-click) stacks a second card onto the selection. */
  onSelect: (id: string | null, additive?: boolean) => void;
  onElements: (picked: LiveSelection[]) => void;
}) {
  /** Caps lifted — every component gets a card, however small. */
  const [all, setAll] = useState(false);
  const [preview, setPreview] = useState<"off" | "on">("off");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Memoised: the view is a dependency of the diagram's measure effect, and a
  // fresh object every render would rebuild its observers on every keystroke.
  const view = useMemo(() => toDiagram(map, { all }), [map, all]);
  const primary = selectedIds[selectedIds.length - 1] ?? null;

  // Element picks come from select.js, injected into the preview by the Go proxy.
  useEffect(() => {
    if (preview === "off") return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; items?: LiveSelection[] };
      if (d?.type !== "terra:selection") return;
      onElements(Array.isArray(d.items) ? d.items : []);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [preview, onElements]);

  const select = (id: string | null, additive?: boolean) => {
    // Searching for a card the caps hid would otherwise select nothing visible.
    if (id && view.hidden.some((c) => c.id === id)) setAll(true);
    onSelect(id, additive);
  };

  return (
    <>
      <div className="sh-ws__mapbar">
        <b>{map.project.name}</b>
        <em>{map.project.description}</em>
        <span className="sh-chip">{map.components.length} components</span>
        <span className="sh-chip">{map.relationships.length} relationships</span>
        <span className="sh-chip">{map.project.primary_languages.join(" · ")}</span>
        {view.hidden.length > 0 && !all && (
          <button type="button" className="sh-chip sh-chip--btn" onClick={() => setAll(true)}>
            +{view.hidden.length} more
          </button>
        )}
        {all && (
          <button type="button" className="sh-chip sh-chip--btn" onClick={() => setAll(false)}>
            Show the main parts
          </button>
        )}
        <button
          type="button"
          className={`sh-chip sh-chip--btn${preview === "on" ? " is-on" : ""}`}
          onClick={() => setPreview((p) => (p === "on" ? "off" : "on"))}
        >
          {preview === "on" ? "Close preview" : "Live preview"}
        </button>
        <MapSearch map={map} onSelect={select} />
      </div>
      <div className={`sh-ws__map${primary ? " has-details" : ""}`}>
        <RepoDiagram
          nodes={view.nodes}
          edges={view.edges}
          groups={view.groups}
          selectedId={primary}
          onSelect={select}
          labelsOnHover
          remeasureKey={preview}
          legendNote="Hover a card to trace its wiring — click to open it, shift-click to stack up to three"
          header={
            <header className="sh-diagram__header">
              <div className="sh-diagram__title">
                <div className="sh-diagram__repo">{map.project.repository_url}</div>
                <div className="sh-diagram__meta">
                  {view.nodes.length} parts · read straight from the code
                </div>
              </div>
            </header>
          }
        />
        {preview === "on" && (
          <div className="sh-ws__preview">
            {/* Boots a real dev server for the mapped repo — only some projects
                have one, so this stays behind the button and says so on failure. */}
            <LiveFrame picking frameRef={frameRef} repoUrl={map.project.repository_url} />
          </div>
        )}
        {primary && (
          <div className="sh-ws__details">
            <DetailsPanel map={map} selectedId={primary} onSelect={onSelect} />
          </div>
        )}
      </div>
    </>
  );
}

function DropStage({
  analyze,
  map,
  selectedIds,
  onSelect,
  onElements,
}: {
  analyze: ReturnType<typeof useAnalyze>;
  map: TerraMap | null;
  selectedIds: string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  onElements: (picked: LiveSelection[]) => void;
}) {
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const { start, status, error, running, elapsed } = analyze;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const repo = url.trim();
    // Shape check only — the Go side owns the real rule and returns a 400
    // with a legible message, which lands in `error`.
    if (!repo || running) return;
    start(repo);
  };

  // ponytail: dropping a repo folder isn't wired — the input is the path in.
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
  };

  return (
    <main className={`sh-ws__stage${map ? " is-map" : ""}`}>
      {map ? (
        <MapStage map={map} selectedIds={selectedIds} onSelect={onSelect} onElements={onElements} />
      ) : running ? (
        <StatusLine label={status?.label ?? "Starting"} elapsed={elapsed} />
      ) : (
        <div
          className={`sh-ws-drop${over ? " is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <span className="sh-ws-drop__glow" aria-hidden />
          <RepoIcon />
          <h1 className="sh-ws-drop__title">Drop a GitHub repo</h1>
          <p className="sh-ws-drop__sub">Terra reads the code and draws the map. No config, no setup.</p>
        </div>
      )}

      {error && <p className="sh-ws__error">{error}</p>}

      <form className="sh-ws__url" onSubmit={submit}>
        <input
          className="sh-ws__input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="github.com/usememos/memos"
          aria-label="GitHub repository URL"
          spellCheck={false}
          disabled={running}
        />
        <button className="sh-btn" type="submit" disabled={running}>
          {running ? "Mapping…" : "Map it"} <ArrowIcon />
        </button>
      </form>
    </main>
  );
}

/**
 * One-shot follow-ups offered once something is selected. Real questions
 * answered by /ask — the landing's Implement hints are scripted CSS tweaks and
 * would fabricate an answer here.
 */
const SELECTION_HINTS = [
  "Explain this selection",
  "Where would I make a change here?",
  "What breaks if I change it?",
  "What depends on this?",
  "Show the evidence",
];

function ThinkingPart({ part }: { part: Extract<AskPart, { type: "thinking" }> }) {
  const [open, setOpen] = useState(!part.done);
  useEffect(() => {
    if (part.done) setOpen(false);
  }, [part.done]);

  return (
    <div className={`sh-ws-think${part.done ? " is-done" : ""}`}>
      <button
        type="button"
        className="sh-ws-think__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sh-terra-mark sh-ws-think__mark" aria-hidden />
        <span className="sh-ws-think__label">{part.done ? "Thought" : "Thinking"}</span>
        <span className="sh-ws-think__chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <p className="sh-ws-think__body">{part.text}</p>}
    </div>
  );
}

function ProcessPart({ part }: { part: Extract<AskPart, { type: "process" }> }) {
  return (
    <ol className="sh-ws-process" aria-label="Work in progress">
      {part.steps.map((step) => (
        <li key={step.id} className={`sh-ws-process__step is-${step.status}`} data-status={step.status}>
          <span className="sh-ws-process__dot" aria-hidden />
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function MessageParts({ message }: { message: AskMessage }) {
  if (message.role === "user") {
    const text = message.parts.find((p) => p.type === "text");
    return (
      <div className="sh-terra-chat__msg sh-terra-chat__msg--user">
        {text && text.type === "text" ? text.text : null}
      </div>
    );
  }

  return (
    <div
      className={`sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn${
        message.error ? " sh-terra-chat__msg--error" : ""
      }`}
    >
      {message.parts.map((part, i) => {
        if (part.type === "thinking") return <ThinkingPart key={i} part={part} />;
        if (part.type === "process") return <ProcessPart key={i} part={part} />;
        if (part.type === "text") {
          return (
            <div
              key={i}
              className="sh-ws-md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

/**
 * Terra's chat for the mapped repo. Wears theater.tsx's TerraChatDock classes
 * but is its own component: that one is unexported and welded to
 * selectionKey / onAsk / live-preview state. Workspace skins it light.
 */
function AgentDock({
  map,
  selected,
  elements,
  onDrop,
}: {
  map: TerraMap | null;
  /** Cards clicked on the map, oldest first — the last one is the subject. */
  selected: Component[];
  /** Elements picked inside the live preview, if it is open. */
  elements: LiveSelection[];
  onDrop: (key: string) => void;
}) {
  const repoUrl = map?.project.repository_url ?? null;
  const { messages, ask, thinking } = useAsk(repoUrl);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  // Same gesture as the theater's chat: transform-only drag, clamped to the arena.
  const { shellRef, onHeadPointerDown, onPointerMove, endGesture } = useFloatingDrag(dockRef);

  useEffect(() => setUsed(new Set()), [repoUrl]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, thinking]);

  // qa.py JSON-dumps these straight into the prompt. `file` is the one key the
  // Go side reads by name — it's what unlocks the source snippet.
  const crumbs = [
    ...selected.map((c) => ({
      key: `c:${c.id}`,
      label: c.name,
      payload: {
        component_id: c.id,
        name: c.name,
        type: c.type,
        purpose: c.purpose,
        tech: c.tech,
        files: c.files,
        file: c.files[0],
      } as AskSelection,
    })),
    ...elements.map((el, i) => ({
      key: elementKey(el, i),
      label: el.name ?? el.tag ?? "element",
      payload: { ...el } as AskSelection,
    })),
  ];
  const selections = crumbs.map((c) => c.payload);
  const primary = selections[selections.length - 1];
  const hasSelection = crumbs.length > 0;

  const send = (q: string) => {
    if (!q.trim() || thinking) return;
    setUsed((prev) => new Set(prev).add(q));
    ask(q, primary, selections);
  };

  // Power theater style: stream suggestions in the prompt while idle (no
  // selection). Chips appear only after a card/element is picked.
  const streamHints = map && !hasSelection
    ? map.suggested_questions.filter((q) => !used.has(q))
    : [];
  const streaming = Boolean(map) && !thinking && draft.length === 0 && streamHints.length > 0;
  const askHint = useStreamingAskHint(!streaming, streamHints);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Empty + streaming → accept the current suggestion (quick ask).
    const q = draft.trim() || (streaming ? askHint.full : "");
    if (!q) return;
    send(q);
    setDraft("");
  };

  const onPromptKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && streaming && askHint.full) {
      e.preventDefault();
      setDraft(askHint.full);
    }
  };

  // One-shot chips only after a selection — same gate as the Power dock.
  const chips = map && hasSelection
    ? SELECTION_HINTS.filter((q) => !used.has(q))
    : [];

  return (
    <div className="sh-ws__dock" ref={dockRef}>
      <div
        className="sh-terra-chat sh-terra-chat--open sh-terra-chat--ws"
        ref={shellRef}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <div className="sh-terra-chat__head" onPointerDown={onHeadPointerDown}>
          <span className="sh-ws-chat__brand">
            <span className="sh-terra-mark sh-ws-chat__mark" aria-hidden />
            <b className="sh-terra-chat__name">Terra</b>
          </span>
        </div>
        <div className="sh-terra-chat__body">
          {crumbs.length > 0 && (
            <div className="sh-ws__crumbs">
              {crumbs.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="sh-terra-chat__crumb"
                  onClick={() => onDrop(c.key)}
                  title="Drop from the question"
                >
                  {c.label} ×
                </button>
              ))}
            </div>
          )}
          <div className="sh-terra-chat__thread" ref={threadRef}>
            {messages.length === 0 && (
              <div className="sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn">
                <p className="sh-ws-md">
                  {map
                    ? `${map.project.name} is mapped. Click any box for its purpose, tech and files — shift-click to ask about several at once.`
                    : "Drop a repo and I'll answer questions about it — what talks to what, where a change lands, why a part exists."}
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageParts key={i} message={m} />
            ))}
          </div>
          {chips.length > 0 && (
            <div className="sh-terra-chat__hints">
              <p className="sh-terra-chat__hints-label">Ask or implement</p>
              {chips.map((q) => (
                <button
                  className="sh-terra-chat__hint"
                  key={q}
                  type="button"
                  disabled={thinking}
                  onClick={() => send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
        <form
          className={`sh-terra-chat__prompt sh-ws__ask${streaming ? " is-streaming" : ""}`}
          onSubmit={submit}
        >
          {streaming && (
            <span className="sh-terra-chat__stream sh-ws__ask-stream" aria-hidden>
              {askHint.text}
              <i className="sh-terra-chat__caret" />
            </span>
          )}
          <input
            className="sh-ws__ask-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder={
              streaming
                ? ""
                : !map
                  ? "Map a repo first"
                  : hasSelection
                    ? "Ask about this selection"
                    : "Ask about this repo"
            }
            aria-label="Ask Terra about this repository"
            disabled={!map || thinking}
          />
        </form>
      </div>
    </div>
  );
}

export default function Workspace() {
  const { slug = "untitled" } = useParams();
  const { search } = useLocation();
  // Lifted so the header star can spin while the stage runs.
  const analyze = useAnalyze();
  /** Up to three cards, oldest first — the theater's cap, for the same reason. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [elements, setElements] = useState<LiveSelection[]>([]);
  /** Session-only: every repo mapped in this tab, newest first. */
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ponytail: dev-only render harness — `?fixture` draws the golden memos map
  // with no Go server. Upgrade path: a real fixture picker if a second map lands.
  const fixture =
    import.meta.env.DEV && new URLSearchParams(search).has("fixture")
      ? (memosFixture as TerraMap)
      : null;
  // A live run always wins, so the URL form still works with the harness on.
  const map = analyze.running ? analyze.map : (analyze.map ?? fixture);

  useEffect(() => {
    setSelectedIds([]);
    setElements([]);
  }, [map]);

  // Re-mapping a repo moves it back to the top rather than listing it twice.
  useEffect(() => {
    if (!map) return;
    const entry = {
      repoUrl: map.project.repository_url,
      name: map.project.name,
      components: map.components.length,
    };
    setHistory((prev) => [entry, ...prev.filter((h) => h.repoUrl !== entry.repoUrl)].slice(0, 8));
  }, [map]);

  const select = (id: string | null, additive?: boolean) => {
    if (!id) return setSelectedIds([]);
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (!additive) return [id];
      return [...prev, id].slice(-MAX_SELECTED);
    });
  };

  /** A crumb's × drops it: `c:` ids come from the map, `e:` from the preview. */
  const dropCrumb = (key: string) => {
    if (key.startsWith("c:")) setSelectedIds((prev) => prev.filter((id) => id !== key.slice(2)));
    else setElements((prev) => prev.filter((el, i) => elementKey(el, i) !== key));
  };

  const selected = selectedIds
    .map((id) => map?.components.find((c) => c.id === id))
    .filter((c): c is Component => !!c);

  return (
    <div className="sh-root sh-ws">
      <WorkspaceHeader slug={slug} busy={analyze.running} />
      <Sidebar
        map={map}
        history={history}
        onSelect={select}
        onReplay={analyze.start}
        busy={analyze.running}
      />
      <DropStage
        analyze={analyze}
        map={map}
        selectedIds={selectedIds}
        onSelect={select}
        onElements={setElements}
      />
      <AgentDock map={map} selected={selected} elements={elements} onDrop={dropCrumb} />
    </div>
  );
}
