import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import {
  LiveFrame,
  MAX_SELECTIONS,
  liveSelectionId,
  selectionLabel,
  useFloatingDrag,
  useStreamingAskHint,
  type LiveSelection,
} from "../../shared/live";
import { spring } from "../../shared/motion";
import { LIVE_NODE_ID, REPO_URL, type DiagramNode } from "./data";

type Picked = { id: string; label: string; sel?: LiveSelection };

/* ---------- replicas ---------- */

const SEED_NOTES = [
  { text: "Shipped the new sync engine — offline edits now merge cleanly.", tags: ["release", "sync"], when: "2h ago" },
  { text: "Reading list: add the SQLite WAL deep-dive before Thursday.", tags: ["reading"], when: "yesterday" },
  { text: "Idea: keyboard-first quick capture from anywhere in the app.", tags: ["idea", "ux"], when: "3d ago" },
];

function MemosReplica({ variant }: { variant: "app" | "notes" }) {
  const [notes, setNotes] = useState(SEED_NOTES);
  const [draft, setDraft] = useState("");
  const post = () => {
    const text = draft.trim();
    if (!text) return;
    setNotes([{ text, tags: ["new"], when: "just now" }, ...notes]);
    setDraft("");
  };
  return (
    <div className="rp-app">
      <header className="rp-head" data-sel="header" data-sel-label="Header">
        <span className="rp-avatar" />
        <b>Memos</b>
        <span className="rp-head__sub">
          {variant === "app" ? "web/src — what people see" : "store/memo.go — what a note looks like"}
        </span>
      </header>
      <div className="rp-composer" data-sel="composer" data-sel-label="Composer">
        <textarea
          placeholder="Any thoughts…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
          }}
        />
        <button className="rp-btn" data-sel="post-btn" data-sel-label="Post button" onClick={post}>
          Post
        </button>
      </div>
      <div className="rp-notes">
        {notes.map((n, i) => (
          <article className="rp-note" data-sel={`note-${i}`} data-sel-label="Note card" key={`${n.text}-${i}`}>
            <p>{n.text}</p>
            <footer>
              {n.tags.map((t) => (
                <span className="rp-tag" key={t}>#{t}</span>
              ))}
              <time>{n.when}</time>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

const EXPLORE_NOTES = [
  {
    who: "steven",
    when: "2h ago",
    text: "Shipped the new sync engine — offline edits now merge cleanly.",
    tags: ["release", "sync"],
  },
  {
    who: "bo",
    when: "yesterday",
    text: "Reading list: add the SQLite WAL deep-dive before Thursday.",
    tags: ["reading"],
  },
  {
    who: "terra",
    when: "3d ago",
    text: "Idea: keyboard-first quick capture from anywhere in the app.",
    tags: ["idea", "ux"],
  },
];

const EXPLORE_TAGS = [
  ["release", 12],
  ["sync", 8],
  ["reading", 5],
  ["idea", 4],
  ["ux", 3],
] as const;

/** Designed Memos shell — dark icon rail (logo / memos / explore / …) + explorer. */
export function MemosExploreReplica() {
  return (
    <div className="rp-shell">
      <nav className="rp-rail" data-sel="nav-rail" data-sel-label="Navigation rail" aria-label="Memos">
        <div className="rp-rail__top">
          <span className="rp-rail__logo" data-sel="logo" data-sel-label="Memos logo">
            <img src="/images/memos/logo.webp" alt="" width={36} height={36} draggable={false} />
          </span>
          <span className="rp-rail__item" data-sel="nav-home" data-sel-label="Memos nav" title="Memos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <path d="m16 6 4 14" />
              <path d="M12 6v14" />
              <path d="M8 8v12" />
              <path d="M4 4v16" />
            </svg>
          </span>
          <span
            className="rp-rail__item is-active"
            data-sel="nav-explore"
            data-sel-label="Explore nav"
            title="Explore"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a14.5 14.5 0 0 0 0 18" />
              <path d="M12 3a14.5 14.5 0 0 1 0 18" />
              <path d="M3 12h18" />
            </svg>
          </span>
          <span className="rp-rail__item" data-sel="nav-attachments" data-sel-label="Attachments nav" title="Attachments">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </span>
          <span className="rp-rail__item" data-sel="nav-inbox" data-sel-label="Inbox nav" title="Inbox">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </span>
        </div>
        <span className="rp-rail__item rp-rail__user" data-sel="nav-user" data-sel-label="User menu" title="Account">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20a8 8 0 0 1 16 0" />
          </svg>
        </span>
      </nav>

      <aside className="rp-explorer" data-sel="explorer" data-sel-label="Explorer sidebar">
        <label className="rp-explorer__search" data-sel="search" data-sel-label="Search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input placeholder="Search memos…" readOnly tabIndex={-1} />
        </label>

        <div className="rp-explorer__stats" data-sel="stats" data-sel-label="Statistics">
          <div className="rp-explorer__stat">
            <b>128</b>
            <span>memos</span>
          </div>
          <div className="rp-explorer__stat">
            <b>14</b>
            <span>tags</span>
          </div>
          <div className="rp-explorer__stat">
            <b>6</b>
            <span>days</span>
          </div>
        </div>

        <div className="rp-explorer__heat" data-sel="heatmap" data-sel-label="Activity" aria-hidden>
          {Array.from({ length: 49 }, (_, i) => (
            <i key={i} style={{ opacity: 0.18 + ((i * 17) % 7) * 0.1 }} />
          ))}
        </div>

        <div className="rp-explorer__section" data-sel="tags" data-sel-label="Tags">
          <span className="rp-explorer__label">Tags</span>
          <ul>
            {EXPLORE_TAGS.map(([tag, count]) => (
              <li key={tag}>
                <span>#{tag}</span>
                <em>{count}</em>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="rp-feed" data-sel="feed" data-sel-label="Explore feed">
        {EXPLORE_NOTES.map((n, i) => (
          <article className="rp-memo" data-sel={`memo-${i}`} data-sel-label="Memo card" key={n.text}>
            <header>
              <span className="rp-avatar" />
              <div>
                <b>{n.who}</b>
                <time>{n.when}</time>
              </div>
              <span className="rp-memo__vis">Public</span>
            </header>
            <p>{n.text}</p>
            <footer>
              {n.tags.map((t) => (
                <span className="rp-tag" key={t}>
                  #{t}
                </span>
              ))}
            </footer>
          </article>
        ))}
      </main>
    </div>
  );
}

function AuthReplica() {
  return (
    <div className="rp-auth">
      <div className="rp-auth__card" data-sel="signin-card" data-sel-label="Sign-in card">
        <span className="rp-avatar rp-avatar--lg" />
        <h4 data-sel="signin-title" data-sel-label="Title">Sign in to Memos</h4>
        <label data-sel="field-user" data-sel-label="Username field">
          Username
          <input placeholder="steven" />
        </label>
        <label data-sel="field-pass" data-sel-label="Password field">
          Password
          <input type="password" placeholder="••••••••" />
        </label>
        <button className="rp-btn rp-btn--wide" data-sel="signin-btn" data-sel-label="Sign-in button">
          Sign in
        </button>
        <button className="rp-btn rp-btn--ghost rp-btn--wide" data-sel="github-btn" data-sel-label="GitHub button">
          Continue with GitHub
        </button>
      </div>
    </div>
  );
}

type DashConfig = {
  title: string;
  sub: string;
  stats: { label: string; value: string }[];
  cols: [string, string, string];
  rows: [string, string, string][];
};

const DASH: Record<string, DashConfig> = {
  api: {
    title: "Request log",
    sub: "internal/api — live traffic",
    stats: [
      { label: "req/min", value: "412" },
      { label: "p50", value: "23ms" },
      { label: "4xx", value: "0.4%" },
    ],
    cols: ["Route", "Method", "Status"],
    rows: [
      ["/api/v1/memos", "GET", "200"],
      ["/api/v1/memos", "POST", "201"],
      ["/api/v1/auth/signin", "POST", "200"],
      ["/api/v1/attachments", "POST", "201"],
      ["/api/v1/memos/42", "DELETE", "204"],
    ],
  },
  files: {
    title: "Uploads",
    sub: "store/attachment.go — what people attach",
    stats: [
      { label: "files", value: "1,284" },
      { label: "size", value: "2.1 GB" },
      { label: "today", value: "37" },
    ],
    cols: ["File", "Type", "Size"],
    rows: [
      ["sketch-v2.png", "image/png", "412 KB"],
      ["notes-export.pdf", "application/pdf", "1.2 MB"],
      ["voice-memo.m4a", "audio/mp4", "3.4 MB"],
      ["roadmap.xlsx", "spreadsheet", "88 KB"],
      ["avatar.jpg", "image/jpeg", "96 KB"],
    ],
  },
  db: {
    title: "terra.db",
    sub: "store/db/sqlite — everything, remembered",
    stats: [
      { label: "tables", value: "9" },
      { label: "rows", value: "18,402" },
      { label: "size", value: "24 MB" },
    ],
    cols: ["Table", "Rows", "Updated"],
    rows: [
      ["memo", "12,381", "just now"],
      ["attachment", "1,284", "2m ago"],
      ["user", "146", "1h ago"],
      ["activity", "4,502", "just now"],
      ["migration_history", "89", "3d ago"],
    ],
  },
};

function DashReplica({ title, sub, stats, cols, rows }: DashConfig) {
  return (
    <div className="rp-dash">
      <header className="rp-head" data-sel="header" data-sel-label="Header">
        <span className="rp-avatar" />
        <b>{title}</b>
        <span className="rp-head__sub">{sub}</span>
      </header>
      <div className="rp-stats" data-sel="stats" data-sel-label="Stat tiles">
        {stats.map((s) => (
          <div className="rp-stat" key={s.label}>
            <b>{s.value}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      <table className="rp-table" data-sel="table" data-sel-label="Table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0] + r[1]}>
              <td><code>{r[0]}</code></td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REPLICAS: Record<string, () => ReactNode> = {
  web: () => <MemosReplica variant="app" />,
  memos: () => <MemosReplica variant="notes" />,
  auth: () => <AuthReplica />,
  api: () => <DashReplica {...DASH.api} />,
  files: () => <DashReplica {...DASH.files} />,
  db: () => <DashReplica {...DASH.db} />,
};

/* ---------- live file browser ---------- */

type FileEntry = { name: string; path: string; dir: boolean };

/** Browses the running preview's checkout — the real web/src, read on the fly. */
function LiveFiles() {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [status, setStatus] = useState("");

  const load = (path: string) => {
    setStatus("");
    fetch(`/files?repo_url=${encodeURIComponent(REPO_URL)}&path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return setStatus(data.error);
        if (data.starting) return setStatus("Starting the dev server… the tree opens once the checkout is ready.");
        if (data.entries) {
          setEntries(data.entries);
          setDir(data.path ?? path);
          setFile(null);
        } else {
          setFile({ path: data.path ?? path, content: data.content ?? "" });
        }
      })
      .catch((e) => setStatus(String(e)));
  };

  // The server serves paths relative to the frontend dir, so "" is the app root.
  useEffect(() => load(""), []);

  const up = dir.split("/").slice(0, -1).join("/");

  return (
    <div className="sh-files">
      <div className="sh-files__crumb">
        {file ? (
          <button className="sh-chip" onClick={() => load(dir)}>
            ← {dir || "app root"}
          </button>
        ) : (
          <button className="sh-chip" onClick={() => load(up)} disabled={!dir}>
            ← up
          </button>
        )}
        <code>{file ? file.path : dir || "/"}</code>
      </div>
      {status && <p className="sh-files__status">{status}</p>}
      {file ? (
        <pre className="sh-files__code">{file.content}</pre>
      ) : (
        <ul className="sh-files__list">
          {entries.map((e) => (
            <li key={e.path}>
              <button className="sh-files__entry" onClick={() => load(e.path)}>
                <span aria-hidden>{e.dir ? "▸" : "·"}</span>
                {e.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- live preview ---------- */


/* ---------- scripted transforms ---------- */

const TRANSFORMS: { match: RegExp; cls: string; reply: string }[] = [
  { match: /space|spacing|padding|room|breath|air|cramped/i, cls: "tf-space", reply: "Added breathing room — padding widened, gap opened up." },
  { match: /colou?r|accent|bright|pop|yellow|brand/i, cls: "tf-accent", reply: "Pulled the brand yellow in as an accent." },
  { match: /hover|interact|click|button|feel/i, cls: "tf-hover", reply: "Added a hover lift and press state." },
  { match: /font|type|text|read|big|legib/i, cls: "tf-type", reply: "Bumped the type scale — heading now set in Fraunces." },
  { match: /round|corner|soft|edge/i, cls: "tf-round", reply: "Softened the corners." },
];
const DEFAULT_TF = { cls: "tf-polish", reply: "Tidied spacing, softened the shadow, rounded the corners." };


/* ---------- terra chat dock ---------- */

type ChatMessage = { role: "user" | "terra"; text: string; error?: boolean };

/** compact = collapsed pill, sheet = docked thread, full = chat covers the stage. */
type ChatMode = "compact" | "sheet" | "full";

/** One-shot ask questions — appear after a component is selected, removed on use. */
const ASK_HINTS = [
  "Explain this selection",
  "Where is this defined?",
  "What depends on this?",
  "How does this talk to the store?",
  "Show the evidence",
] as const;

/**
 * One-shot frontend design suggestions for Implement with Terra.
 * Each maps to a scripted visual transform so the change is visible in the preview.
 */
export const IMPLEMENT_HINTS = [
  "Give this more breathing room",
  "Add a brand accent color",
  "Make buttons feel clickable on hover",
  "Bump the type for readability",
  "Soften the corners",
] as const;


/**
 * Floating Terra dock — no free typing. Select a component to reveal one-shot
 * options (ask questions or design tweaks); each option disappears after use.
 */
function TerraChatDock({
  selectionKey,
  crumb,
  onAsk,
  onHeadPointerDown,
  hints = ASK_HINTS,
  /** Implement: design chips. Ask: question chips. */
  designMode = false,
}: {
  selectionKey: string | null;
  crumb: string | null;
  onAsk: (question: string) => Promise<string>;
  onHeadPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  hints?: readonly string[];
  designMode?: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<ChatMode>("compact");
  /** Options already used for each selected component (by selection key). */
  const [usedBySel, setUsedBySel] = useState<Record<string, string[]>>({});
  const threadRef = useRef<HTMLDivElement | null>(null);
  const open = mode !== "compact";
  const usedForSel = selectionKey ? usedBySel[selectionKey] ?? [] : [];
  const options = selectionKey ? hints.filter((h) => !usedForSel.includes(h)) : [];
  const optionsLabel = designMode ? "Design this component" : "Ask about this component";
  const exhaustedMsg = designMode
    ? "Every design tweak for this component is already applied. Pick another element."
    : "You've asked every question for this component. Pick another element.";
  // Idle prompt streams the suggestion list; pause once a component is picked.
  const streaming = !selectionKey && !thinking && hints.length > 0;
  const askHint = useStreamingAskHint(!streaming, hints);

  // Selection opens the dock so option chips stay visible for that component.
  useEffect(() => {
    if (selectionKey) {
      setMode((m) => (m === "compact" ? "sheet" : m));
      return;
    }
    setMode((m) => (messages.length ? m : "compact"));
  }, [selectionKey, messages.length]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, thinking, mode, options.length]);

  const sendOption = async (raw: string) => {
    const q = raw.trim();
    const sel = selectionKey;
    if (!q || thinking || !sel) return;
    // Pull the option immediately so it can't be spammed while Terra answers.
    if ((usedBySel[sel] ?? []).includes(q)) return;
    setUsedBySel((prev) => ({
      ...prev,
      [sel]: [...(prev[sel] ?? []), q],
    }));
    setMode((m) => (m === "compact" ? "sheet" : m));
    setMessages((m) => [...m, { role: "user", text: q }]);
    setThinking(true);
    try {
      const text = await onAsk(q);
      setMessages((m) => [...m, { role: "terra", text }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "terra", text: String(e), error: true }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div
      className={`sh-terra-chat ${open ? "sh-terra-chat--open" : ""} ${
        mode === "full" ? "sh-terra-chat--full" : ""
      }`}
    >
      <div className="sh-terra-chat__head" onPointerDown={onHeadPointerDown}>
        <span className="sh-terra-chat__lights" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <b className="sh-terra-chat__name">Terra</b>
        {open && (
          <span className="sh-terra-chat__tools" data-no-drag>
            <button
              className="sh-terra-chat__ctl"
              onClick={() => setMode(mode === "full" ? "sheet" : "full")}
              aria-label={mode === "full" ? "Exit chat fullscreen" : "Expand chat to fullscreen"}
              title={mode === "full" ? "Exit fullscreen" : "Fullscreen chat"}
            >
              {mode === "full" ? "⤡" : "⤢"}
            </button>
            <button className="sh-terra-chat__ctl" onClick={() => setMode("compact")} aria-label="Collapse chat">
              ⌄
            </button>
          </span>
        )}
      </div>

      {/* No exit animation — a lingering body would stretch the collapsed dock. */}
      {open && (
        <div className="sh-terra-chat__body">
          {crumb && <span className="sh-terra-chat__crumb">{crumb}</span>}
          <div className="sh-terra-chat__thread" ref={threadRef}>
            {selectionKey && options.length === 0 && (
              <p className="sh-terra-chat__msg sh-terra-chat__msg--terra">{exhaustedMsg}</p>
            )}
            {messages.map((m, i) => (
              <p
                className={`sh-terra-chat__msg sh-terra-chat__msg--${m.role} ${
                  m.error ? "sh-terra-chat__msg--error" : ""
                }`}
                key={i}
              >
                {m.text}
              </p>
            ))}
            {thinking && (
              <div className="sh-terra-chat__thinking" aria-live="polite">
                <span className="sh-terra-chat__thinking-mark" aria-hidden />
                <span className="sh-terra-chat__thinking-label">Terra is thinking</span>
              </div>
            )}
          </div>
          {selectionKey && options.length > 0 && (
            <div className="sh-terra-chat__hints" data-no-drag>
              <p className="sh-terra-chat__hints-label">{optionsLabel}</p>
              {options.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="sh-terra-chat__hint"
                  disabled={thinking}
                  onClick={() => sendOption(h)}
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Read-only prompt — free typing off; idle streams suggestion animation. */}
      <div className="sh-terra-chat__prompt" data-no-drag aria-live="polite">
        {streaming ? (
          <span className="sh-terra-chat__stream">
            {askHint.text}
            <i className="sh-terra-chat__caret" />
          </span>
        ) : selectionKey ? (
          options.length > 0 ? (
            optionsLabel
          ) : (
            "Pick another component"
          )
        ) : (
          designMode ? "Select a component to redesign" : "Select a component to ask about"
        )}
      </div>
    </div>
  );
}

/* ---------- theater panel ---------- */

/**
 * The theater itself. Rendered inline inside the repo card; chrome is a single
 * label chip, and the stage is always the live demo in inspect mode.
 */
export function TheaterPanel({
  node,
  onClose,
  className = "",
  chatHints,
  designMode = false,
  /** Force the clickable explore replica instead of the live Ask iframe. */
  exploreReplica = false,
}: {
  node: DiagramNode;
  onClose: () => void;
  className?: string;
  /** One-shot option chips — Ask questions or Implement design tweaks. */
  chatHints?: readonly string[];
  /** Implement tab: scripted visible design tweaks, each once. */
  designMode?: boolean;
  exploreReplica?: boolean;
}) {
  // Fixed: no tab bar and no Inspect/Action toggle — the panel is always the
  // live demo in inspect mode. The Files view stays wired for a future entry point.
  const [tab] = useState<"demo" | "files">("demo");
  const [selected, setSelected] = useState<Picked[]>([]);
  const [picking] = useState(true);
  const selectedEls = useRef<HTMLElement[]>([]);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Design transforms already applied per live/replica selection id. */
  const appliedTf = useRef(new Map<string, Set<string>>());
  const { shellRef, onHeadPointerDown, onPointerMove, endGesture } = useFloatingDrag(panelRef);
  const live = node.id === LIVE_NODE_ID && !exploreReplica;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clearSelection = () => {
    for (const el of selectedEls.current) el.classList.remove("is-selected");
    selectedEls.current = [];
    setSelected([]);
    frameRef.current?.contentWindow?.postMessage({ type: "terra:clear-selection" }, "*");
  };

  // Selections arrive from the injected select.js inside the live iframe.
  useEffect(() => {
    if (!live) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as LiveSelection & { type?: string; items?: LiveSelection[] };
      if (d?.type !== "terra:selection") return;
      const items = Array.isArray(d.items) ? d.items : d.name || d.tag ? [d] : [];
      setSelected(
        items.map((item) => {
          const label = selectionLabel(item);
          return { id: liveSelectionId(item), label, sel: item };
        }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [live]);

  // Click outside the live/replica screen clears inspect focus.
  useEffect(() => {
    if (!picking || tab !== "demo") return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      // Anything in the preview surface or Terra chrome keeps the selection.
      if (
        t.closest(
          "iframe.sh-live, .sh-replica--live, .sh-replica:not(.sh-replica--live), .sh-theater__dock, .sh-theater__chrome, .sh-theater__files",
        )
      ) {
        return;
      }
      clearSelection();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [picking, tab]);

  const pick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sel]");
    // Empty chrome / outside a selectable node resets focus.
    if (!el) {
      clearSelection();
      return;
    }
    const id = el.dataset.sel!;
    const label = el.dataset.selLabel ?? id;
    const existing = selectedEls.current.indexOf(el);
    if (existing >= 0) {
      el.classList.remove("is-selected");
      selectedEls.current = selectedEls.current.filter((n) => n !== el);
      setSelected((prev) => prev.filter((p) => p.id !== id));
      return;
    }
    let droppedId: string | null = null;
    if (selectedEls.current.length >= MAX_SELECTIONS) {
      const oldest = selectedEls.current.shift();
      droppedId = oldest?.dataset.sel ?? null;
      oldest?.classList.remove("is-selected");
    }
    el.classList.add("is-selected");
    selectedEls.current = [...selectedEls.current, el];
    setSelected((prev) => {
      const next = prev.filter((p) => p.id !== id && p.id !== droppedId);
      return [...next.slice(0, MAX_SELECTIONS - 1), { id, label }];
    });
  };

  /** Apply a one-shot visual design transform to the current selection. */
  const applyDesignTransform = (q: string) => {
    const tf = TRANSFORMS.find((t) => t.match.test(q)) ?? DEFAULT_TF;
    const selKey =
      selected.length > 0
        ? selected.map((s) => s.id).join(",")
        : "__none__";
    // HMR can leave a stale Set in this ref from the older one-shot shape.
    if (!(appliedTf.current instanceof Map)) {
      appliedTf.current = new Map();
    }
    let used = appliedTf.current.get(selKey);
    if (!used) {
      used = new Set();
      appliedTf.current.set(selKey, used);
    }
    if (used.has(tf.cls)) {
      return "That tweak is already on this component — pick another design change.";
    }
    if (selKey === "__none__") {
      return "Select a component in the preview first, then choose a design change.";
    }
    used.add(tf.cls);
    for (const el of selectedEls.current) {
      el.classList.add(tf.cls, "tf-pulse");
      setTimeout(() => el.classList.remove("tf-pulse"), 650);
    }
    frameRef.current?.contentWindow?.postMessage(
      { type: "terra:transform", cls: tf.cls },
      "*",
    );
    return tf.reply;
  };

  /** Live repos answer over /ask; design mode + replicas run scripted transforms. */
  const ask = async (q: string) => {
    if (designMode) {
      await new Promise((done) => setTimeout(done, 700));
      return applyDesignTransform(q);
    }
    if (live) {
      const sels = selected.map((s) => s.sel).filter(Boolean) as LiveSelection[];
      const r = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: REPO_URL,
          question: q,
          selection: sels[sels.length - 1] ?? {},
          selections: sels,
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      return (data.answer as string) ?? "No answer.";
    }
    await new Promise((done) => setTimeout(done, 900));
    return applyDesignTransform(q);
  };

  const selectionKey = selected.length ? selected.map((s) => s.id).join(",") : null;
  const crumb =
    selected.length > 0 ? `${node.label} › ${selected.map((s) => s.label).join(", ")}` : null;

  const replica = exploreReplica
    ? () => <MemosExploreReplica />
    : REPLICAS[node.id];

  // Esc and ✕ are the only ways out — a stray click outside shouldn't dump a live session.
  return (
    <motion.div
      ref={panelRef}
      className={`sh-theater__panel ${className}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      transition={spring}
    >
      <div className="sh-theater__stage">
        {tab === "demo" ? (
          live ? (
            <div className="sh-replica sh-replica--live" data-node={node.id}>
              <LiveFrame picking={picking} frameRef={frameRef} repoUrl={REPO_URL} />
            </div>
          ) : (
            <div
              className={`sh-replica${exploreReplica ? " sh-replica--explore" : ""}`}
              data-node={node.id}
              onClick={pick}
            >
              {replica ? replica() : <p>No demo for this component yet.</p>}
            </div>
          )
        ) : (
          <div className="sh-theater__files">
            {live ? (
              <LiveFiles />
            ) : (
            <div className="sh-evidence">
              <div className="sh-evidence__head">
                {node.label} <span>{node.hint}</span>
              </div>
              {node.files.map((f) => (
                <div className="sh-evidence__row" key={f.path}>
                  <code>{f.path}</code>
                  <small>{f.why}</small>
                </div>
              ))}
            </div>
            )}
          </div>
        )}
      </div>

      {/* ponytail: chrome is a label only — the hero's own tabs do the navigating,
          and the panel is permanently in Inspect mode. */}
      <div className="sh-theater__chrome">
        <span className="sh-chip sh-theater__label">
          <span className="sh-chip__mark" />
          {exploreReplica ? "Memos" : node.label}
          <span className="sh-theater__hint">
            {exploreReplica
              ? "Click a piece of UI, then redesign it"
              : designMode
                ? "Click a piece of UI, then redesign it"
                : "Click a piece of UI, then pick a question"}
          </span>
        </span>
      </div>

      {/* Hidden rather than unmounted on Files so the thread survives a tab peek. */}
      <div
        ref={shellRef}
        className={`sh-theater__dock ${tab !== "demo" ? "sh-theater__dock--hidden" : ""}`}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        inert={tab !== "demo"}
      >
        <TerraChatDock
          selectionKey={selectionKey}
          crumb={crumb}
          onAsk={ask}
          onHeadPointerDown={onHeadPointerDown}
          hints={chatHints ?? (designMode ? IMPLEMENT_HINTS : ASK_HINTS)}
          designMode={designMode}
        />
      </div>
    </motion.div>
  );
}

/* ---------- fullscreen escalation ---------- */

/** The ⤢ turn: same panel, portalled over the page. ⤡ hands it back inline. */
export function TheaterModal({ node, onClose }: { node: DiagramNode; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return createPortal(
    <motion.div
      className="sh-theater sh-theater--full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <TheaterPanel node={node} onClose={onClose} />
    </motion.div>,
    document.body,
  );
}
