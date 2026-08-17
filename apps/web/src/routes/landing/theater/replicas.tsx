import { useState, type ReactNode } from "react";
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

export const REPLICAS: Record<string, () => ReactNode> = {
  web: () => <MemosReplica variant="app" />,
  memos: () => <MemosReplica variant="notes" />,
  auth: () => <AuthReplica />,
  api: () => <DashReplica {...DASH.api} />,
  files: () => <DashReplica {...DASH.files} />,
  db: () => <DashReplica {...DASH.db} />,
};
