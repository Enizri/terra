import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { MAX_SELECTIONS } from "../../shared/limits";
import {
  LiveFrame,
  liveSelectionId,
  selectionLabel,
  type LiveSelection,
} from "../../features/preview";
import { useFloatingDrag, useStreamingAskHint } from "../../shared/live";
import { ask as askServer } from "../../features/ask";
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

/** Shared Memos icon rail — `active` marks Home vs Explore. */
function MemosRail({ active }: { active: "home" | "explore" }) {
  return (
    <nav className="rp-rail" aria-label="Memos">
      <div className="rp-rail__top">
        <span className="rp-rail__logo" data-sel="logo" data-sel-label="Memos logo">
          <img src="/images/memos/logo.webp" alt="" width={36} height={36} draggable={false} />
        </span>
        <span
          className={`rp-rail__item${active === "home" ? " is-active" : ""}`}
          data-sel="nav-home"
          data-sel-label="Memos nav"
          title="Memos"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="m16 6 4 14" />
            <path d="M12 6v14" />
            <path d="M8 8v12" />
            <path d="M4 4v16" />
          </svg>
        </span>
        <span
          className={`rp-rail__item${active === "explore" ? " is-active" : ""}`}
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
  );
}

/** Clickable Memos home replica — composer + personal feed (Ask demo). */
export function MemosHomeReplica() {
  const [notes, setNotes] = useState(SEED_NOTES);
  const [draft, setDraft] = useState("");
  const post = () => {
    const text = draft.trim();
    if (!text) return;
    setNotes([{ text, tags: ["new"], when: "just now" }, ...notes]);
    setDraft("");
  };
  return (
    <div className="rp-shell rp-shell--home">
      <MemosRail active="home" />
      <main className="rp-home">
        <header className="rp-home__title" data-sel="home-title" data-sel-label="Home title">
          <b>Memos</b>
          <span>Your notes</span>
        </header>
        <div className="rp-home__board" data-sel="board" data-sel-label="Notes board">
          <div className="rp-home__composer" data-sel="composer" data-sel-label="Composer">
            <span className="rp-avatar" data-sel="avatar" data-sel-label="Avatar" />
            <textarea
              placeholder="Any thoughts…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
              }}
            />
            <button className="rp-btn" type="button" data-sel="post-btn" data-sel-label="Post button" onClick={post}>
              Post
            </button>
          </div>
          <div className="rp-home__feed">
            {notes.map((n, i) => (
              <article className="rp-memo" data-sel={`note-${i}`} data-sel-label="Memo card" key={`${n.text}-${i}`}>
                <header>
                  <span className="rp-avatar" />
                  <div>
                    <b>you</b>
                    <time>{n.when}</time>
                  </div>
                  <span className="rp-memo__vis">Private</span>
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
          </div>
        </div>
      </main>
    </div>
  );
}

/** Clickable Memos explore replica (Implement demo). */
export function MemosExploreReplica() {
  return (
    <div className="rp-shell">
      <MemosRail active="explore" />

      <aside className="rp-explorer">
        <label className="rp-explorer__search" data-sel="search" data-sel-label="Search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input placeholder="Search memos…" readOnly tabIndex={-1} />
        </label>

        <div className="rp-explorer__stats">
          <div className="rp-explorer__stat" data-sel="stat-memos" data-sel-label="Memos count">
            <b>128</b>
            <span>memos</span>
          </div>
          <div className="rp-explorer__stat" data-sel="stat-tags" data-sel-label="Tags count">
            <b>14</b>
            <span>tags</span>
          </div>
          <div className="rp-explorer__stat" data-sel="stat-days" data-sel-label="Days count">
            <b>6</b>
            <span>days</span>
          </div>
        </div>

        <div className="rp-explorer__heat" data-sel="heatmap" data-sel-label="Activity" aria-hidden>
          {Array.from({ length: 49 }, (_, i) => (
            <i key={i} style={{ opacity: 0.18 + ((i * 17) % 7) * 0.1 }} />
          ))}
        </div>

        <div className="rp-explorer__section">
          <span className="rp-explorer__label">Tags</span>
          <ul>
            {EXPLORE_TAGS.map(([tag, count]) => (
              <li key={tag} data-sel={`tag-${tag}`} data-sel-label={`Tag ${tag}`}>
                <span>#{tag}</span>
                <em>{count}</em>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="rp-feed">
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

export type ChatMessage = { role: "user" | "terra"; text: string; error?: boolean };

type ChatMode = "compact" | "sheet" | "full";

/** Imperative chat controls for the scripted hero film. */
export type ChatScriptHandle = {
  postUser(text: string): void;
  postTerra(text: string): void;
  setThinking(on: boolean): void;
  /** Typewriter text shown in the read-only prompt row; "" clears. */
  setPromptText(text: string): void;
};

/** Marketing Ask chips (Power of Terra — canned, no backend). */
export const ASK_HINTS = [
  "Explain this selection",
  "Where is this defined?",
  "What depends on this?",
  "How does this talk to the store?",
  "Show the evidence",
] as const;

/** Hardcoded Ask replies keyed by chip text — marketing demo only. */
const DEMO_ASK_REPLIES: Record<(typeof ASK_HINTS)[number], string> = {
  "Explain this selection":
    "This is part of Memos' explore surface — the UI people use to browse notes. On the map it sits under Web App and talks to the API for every list and search.",
  "Where is this defined?":
    "Defined in the frontend tree (web/src). Terra ties the selection to that path so you can jump from the map straight into the files that own this UI.",
  "What depends on this?":
    "Explore depends on the Request Handler (API) for memo lists and tags. Upstream, Sign-in gates who can see private notes before this screen loads.",
  "How does this talk to the store?":
    "It never touches the database directly — the Web App calls the API, Notes writes memos, and Storage (terra.db / SQLite) persists them. The map edge is web → api → memos → db.",
  "Show the evidence":
    "Evidence lives on the map edges: memo_service routes, store/memo.go, and the explore feed components. Each claim links back to those files — not a guessed summary.",
};

const DEMO_ASK_FALLBACK =
  "On the Memos map this UI belongs to Web App. It reaches Storage only through the API and Notes layers — pick another question for a tighter answer.";

/** One-shot Implement design chips (scripted preview transforms). */
export const IMPLEMENT_HINTS = [
  "Give this more breathing room",
  "Add a brand accent color",
  "Make buttons feel clickable on hover",
  "Bump the type for readability",
  "Soften the corners",
] as const;


/** Floating dock: one-shot chips after selection. */
export function TerraChatDock({
  selectionKey,
  crumb,
  onAsk,
  onHeadPointerDown,
  hints = ASK_HINTS,
  designMode = false,
  scripted = false,
  scriptRef,
  initialMessages,
  wsSkin = false,
  greeting,
}: {
  selectionKey: string | null;
  crumb: string | null;
  onAsk: (question: string) => Promise<string>;
  onHeadPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  hints?: readonly string[];
  designMode?: boolean;
  /** Scripted hero film: no chips, prompt text driven via `scriptRef`. */
  scripted?: boolean;
  scriptRef?: Ref<ChatScriptHandle>;
  initialMessages?: ChatMessage[];
  /** Workspace column look: light skin, brand head, always open. */
  wsSkin?: boolean;
  /** Opening Terra turn shown while the thread is empty (workspace dock). */
  greeting?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<ChatMode>(wsSkin ? "sheet" : "compact");
  const [usedBySel, setUsedBySel] = useState<Record<string, string[]>>({});
  const [scriptPrompt, setScriptPrompt] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const open = mode !== "compact";
  const usedForSel = selectionKey ? usedBySel[selectionKey] ?? [] : [];
  const options = selectionKey && !scripted ? hints.filter((h) => !usedForSel.includes(h)) : [];
  const optionsLabel = designMode ? "Design this component" : "Ask about this component";
  const exhaustedMsg = designMode
    ? "Every design tweak for this component is already applied. Pick another element."
    : "You've asked every question for this component. Pick another element.";
  const streaming = !scripted && !selectionKey && !thinking && hints.length > 0;
  const askHint = useStreamingAskHint(!streaming, hints);

  useImperativeHandle(scriptRef, () => ({
    postUser: (text: string) => setMessages((m) => [...m, { role: "user", text }]),
    postTerra: (text: string) => setMessages((m) => [...m, { role: "terra", text }]),
    setThinking,
    setPromptText: setScriptPrompt,
  }));

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
      }${wsSkin ? " sh-terra-chat--ws" : ""}`}
    >
      <div className="sh-terra-chat__head" onPointerDown={onHeadPointerDown}>
        {wsSkin ? (
          <span className="sh-ws-chat__brand">
            <span className="sh-terra-mark sh-ws-chat__mark" aria-hidden />
            <b className="sh-terra-chat__name">Terra</b>
          </span>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* No exit animation — a lingering body would stretch the collapsed dock. */}
      {open && (
        <div className="sh-terra-chat__body">
          {crumb &&
            (wsSkin ? (
              /* Workspace dock shows selections as droppable chips. */
              <div className="sh-ws__crumbs">
                <button type="button" className="sh-terra-chat__crumb">
                  {crumb} ×
                </button>
              </div>
            ) : (
              <span className="sh-terra-chat__crumb">{crumb}</span>
            ))}
          <div className="sh-terra-chat__thread" ref={threadRef}>
            {!scripted && selectionKey && options.length === 0 && (
              <p className="sh-terra-chat__msg sh-terra-chat__msg--terra">{exhaustedMsg}</p>
            )}
            {wsSkin && greeting && messages.length === 0 && (
              <div className="sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn">
                <p className="sh-ws-md">{greeting}</p>
              </div>
            )}
            {messages.map((m, i) =>
              wsSkin && m.role === "terra" ? (
                <div
                  className={`sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn${
                    m.error ? " sh-terra-chat__msg--error" : ""
                  }`}
                  key={i}
                >
                  <p className="sh-ws-md">{m.text}</p>
                </div>
              ) : (
                <p
                  className={`sh-terra-chat__msg sh-terra-chat__msg--${m.role} ${
                    m.error ? "sh-terra-chat__msg--error" : ""
                  }`}
                  key={i}
                >
                  {m.text}
                </p>
              ),
            )}
            {thinking &&
              (wsSkin ? (
                /* Workspace thinking row — spinning mark, no dark shimmer. */
                <div className="sh-ws-think" aria-live="polite">
                  <span className="sh-ws-think__toggle">
                    <span className="sh-terra-mark sh-terra-mark--spin sh-ws-think__mark" aria-hidden />
                    <span className="sh-ws-think__label">Thinking</span>
                  </span>
                </div>
              ) : (
                <div className="sh-terra-chat__thinking" aria-live="polite">
                  <span className="sh-terra-chat__thinking-mark" aria-hidden />
                  <span className="sh-terra-chat__thinking-label">Terra is thinking</span>
                </div>
              ))}
          </div>
          {selectionKey && options.length > 0 && !thinking && (
            <div
              className={`sh-terra-chat__hints${
                messages.length > 0 ? " sh-terra-chat__hints--compact" : ""
              }`}
              data-no-drag
            >
              {messages.length === 0 && (
                <p className="sh-terra-chat__hints-label">{optionsLabel}</p>
              )}
              {options.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="sh-terra-chat__hint"
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
      {wsSkin ? (
        /* Workspace ask row — the film types into the real input. */
        <form className="sh-terra-chat__prompt sh-ws__ask" onSubmit={(e) => e.preventDefault()}>
          <input
            className="sh-ws__ask-input"
            value={scriptPrompt}
            placeholder={selectionKey ? "Ask about this selection" : "Ask about this repo"}
            aria-label="Ask Terra about this repository"
            readOnly
          />
        </form>
      ) : (
      <div className="sh-terra-chat__prompt" data-no-drag aria-live="polite">
        {scripted ? (
          scriptPrompt ? (
            <span className="sh-terra-chat__stream">
              {scriptPrompt}
              <i className="sh-terra-chat__caret" />
            </span>
          ) : (
            "Ask Terra about this component"
          )
        ) : streaming ? (
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
      )}
    </div>
  );
}

/* ---------- theater panel ---------- */

/** Imperative panel controls for the scripted hero film. */
export type TheaterScriptHandle = {
  /** Element for a `data-sel` key inside the replica stage. */
  getSelEl(key: string): HTMLElement | null;
  hoverSel(key: string | null): void;
  selectSel(key: string): void;
  /** Runs the existing transform table; returns Terra's reply line. */
  applyTransform(query: string): string;
  chat: ChatScriptHandle | null;
};

/** Inline theater panel (inspect mode). */
export function TheaterPanel({
  node,
  onClose,
  className = "",
  chatHints,
  designMode = false,
  /** Marketing Power tabs: static Memos UI, no LiveFrame. */
  demoReplica,
  scripted = false,
  scriptRef,
  initialMessages,
  hideDock = false,
}: {
  node: DiagramNode;
  onClose: () => void;
  className?: string;
  chatHints?: readonly string[];
  designMode?: boolean;
  demoReplica?: "home" | "explore";
  /** Scripted hero film: page-level listeners off, controls via `scriptRef`. */
  scripted?: boolean;
  scriptRef?: Ref<TheaterScriptHandle>;
  initialMessages?: ChatMessage[];
  /** Chat lives elsewhere (workspace dock column) — skip the floating dock. */
  hideDock?: boolean;
}) {
  const [selected, setSelected] = useState<Picked[]>([]);
  const selectedEls = useRef<HTMLElement[]>([]);
  const hoverEl = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const appliedTf = useRef(new Map<string, Set<string>>());
  const chatScriptRef = useRef<ChatScriptHandle | null>(null);
  const { shellRef, onHeadPointerDown, onPointerMove, endGesture } = useFloatingDrag(panelRef);
  const live = node.id === LIVE_NODE_ID && !demoReplica;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (!scripted) window.addEventListener("keydown", onKey);
    return () => {
      if (!scripted) window.removeEventListener("keydown", onKey);
      hoverEl.current?.classList.remove("is-hover");
      hoverEl.current = null;
    };
  }, [onClose, scripted]);

  const clearHover = () => {
    hoverEl.current?.classList.remove("is-hover");
    hoverEl.current = null;
  };

  const setHover = (el: HTMLElement | null) => {
    if (el === hoverEl.current) return;
    hoverEl.current?.classList.remove("is-hover");
    hoverEl.current = el;
    el?.classList.add("is-hover");
  };

  /** Deepest [data-sel] under the pointer (ignores nested ancestors). */
  const hitSelectable = (clientX: number, clientY: number): HTMLElement | null => {
    const root = stageRef.current;
    if (!root) return null;
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const node of stack) {
      if (!(node instanceof HTMLElement)) continue;
      if (!root.contains(node)) continue;
      if (node.classList.contains("sh-replica") || node === root) continue;
      const hit = node.closest<HTMLElement>("[data-sel]");
      if (hit && root.contains(hit)) return hit;
    }
    return null;
  };

  const onReplicaPointerMove = (e: React.PointerEvent) => {
    setHover(hitSelectable(e.clientX, e.clientY));
  };

  const clearSelection = () => {
    for (const el of selectedEls.current) el.classList.remove("is-selected");
    selectedEls.current = [];
    setSelected([]);
    frameRef.current?.contentWindow?.postMessage({ type: "terra:clear-selection" }, "*");
  };

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

  useEffect(() => {
    if (scripted) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.closest(
          "iframe.sh-live, .sh-replica--live, .sh-replica:not(.sh-replica--live), .sh-theater__dock, .sh-theater__chrome",
        )
      ) {
        return;
      }
      clearSelection();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [scripted]);

  const pickEl = (el: HTMLElement | null) => {
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

  const pick = (e: React.MouseEvent) => pickEl(hitSelectable(e.clientX, e.clientY));

  const applyDesignTransform = (q: string) => {
    const tf = TRANSFORMS.find((t) => t.match.test(q)) ?? DEFAULT_TF;
    // Key off the raw elements, not `selected` state: the scripted film calls
    // select + transform in one tick, before the state commit lands.
    const pickedIds = selectedEls.current.map((el) => el.dataset.sel!);
    const selKey = pickedIds.length > 0 ? pickedIds.join(",") : "__none__";
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

  const getSelEl = (key: string) =>
    stageRef.current?.querySelector<HTMLElement>(`[data-sel="${key}"]`) ?? null;

  // Recreated every render so the closures never go stale.
  useImperativeHandle(scriptRef, () => ({
    getSelEl,
    hoverSel: (key: string | null) => setHover(key ? getSelEl(key) : null),
    selectSel: (key: string) => pickEl(getSelEl(key)),
    applyTransform: applyDesignTransform,
    get chat() {
      return chatScriptRef.current;
    },
  }));

  const demoAskReply = (q: string) => {
    const hit = ASK_HINTS.find((h) => h === q);
    return hit ? DEMO_ASK_REPLIES[hit] : DEMO_ASK_FALLBACK;
  };

  const ask = async (q: string) => {
    if (designMode) {
      await new Promise((done) => setTimeout(done, 1100));
      return applyDesignTransform(q);
    }
    // Marketing Power Ask: static home replica + canned answers (no /preview or /ask).
    if (demoReplica) {
      await new Promise((done) => setTimeout(done, 2200));
      return demoAskReply(q);
    }
    if (live) {
      const sels = selected.map((s) => s.sel).filter(Boolean) as LiveSelection[];
      return askServer(REPO_URL, q, sels);
    }
    await new Promise((done) => setTimeout(done, 900));
    return applyDesignTransform(q);
  };

  const selectionKey = selected.length ? selected.map((s) => s.id).join(",") : null;
  const crumb =
    selected.length > 0 ? `${node.label} › ${selected.map((s) => s.label).join(", ")}` : null;

  const replica =
    demoReplica === "home"
      ? () => <MemosHomeReplica />
      : demoReplica === "explore"
        ? () => <MemosExploreReplica />
        : REPLICAS[node.id];

  return (
    <motion.div
      ref={panelRef}
      className={`sh-theater__panel ${className}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      transition={spring}
    >
      <div className="sh-theater__stage" ref={stageRef}>
        {live ? (
          <div className="sh-replica sh-replica--live" data-node={node.id}>
            <LiveFrame picking frameRef={frameRef} repoUrl={REPO_URL} />
          </div>
        ) : (
          <div
            className={`sh-replica${demoReplica ? " sh-replica--explore" : ""}`}
            data-node={node.id}
            onClick={pick}
            onPointerMove={onReplicaPointerMove}
            onPointerLeave={clearHover}
          >
            {replica ? replica() : <p>No demo for this component yet.</p>}
          </div>
        )}
      </div>

      <div className="sh-theater__chrome">
        <span className="sh-chip sh-theater__label">
          <span className="sh-chip__mark" />
          {demoReplica ? "Memos" : node.label}
          <span className="sh-theater__hint">
            {scripted
              ? "Terra picks a component and redesigns it"
              : designMode
                ? "Click a piece of UI, then redesign it"
                : "Click a piece of UI, then pick a question"}
          </span>
        </span>
      </div>

      {!hideDock && (
        <div
          ref={shellRef}
          className="sh-theater__dock"
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          <TerraChatDock
            selectionKey={selectionKey}
            crumb={crumb}
            onAsk={ask}
            onHeadPointerDown={onHeadPointerDown}
            hints={chatHints ?? (designMode ? IMPLEMENT_HINTS : ASK_HINTS)}
            designMode={designMode}
            scripted={scripted}
            scriptRef={chatScriptRef}
            initialMessages={initialMessages}
          />
        </div>
      )}
    </motion.div>
  );
}

/* ---------- fullscreen escalation ---------- */

/** Fullscreen theater portal. */
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
