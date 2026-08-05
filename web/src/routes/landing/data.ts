export const IMG = "/terra/images";

/** Repo whose real frontend the theater previews live (via terra serve). */
export const REPO_URL = "github.com/usememos/memos";
/** Diagram node that gets the live preview instead of a replica. */
export const LIVE_NODE_ID = "web";

export const spring = { type: "spring", damping: 60, stiffness: 400 } as const;

// Section reveal trigger: fires when ~40% of the section is visible
// (headings reveal around mid-viewport on tall sections, near the bottom
// edge on short ones like the footer).
export const inView = { once: true, amount: 0.4 } as const;

export const stagger = {
  show: { transition: { staggerChildren: 0.1 } },
} as const;

export const rise = {
  hidden: { opacity: 0, y: 150 },
  show: { opacity: 1, y: 0, transition: spring },
} as const;

export const pop = {
  hidden: { opacity: 0, scale: 0.5 },
  show: { opacity: 1, scale: 1, transition: spring },
} as const;

export type User = {
  id: string;
  name: string;
  email: string;
  photo: string;
  permission: string;
  align?: "tl" | "tr" | "bl" | "br";
  offset: { desktop: { x: [number, number]; y: [number, number] } };
  color: { ring: string; background: string; arrow: string };
};

export const users: User[] = [
  {
    id: "1",
    name: "Giel",
    email: "giel@terra.app",
    photo: `${IMG}/avatar-1`,
    permission: "Can edit",
    align: "tl",
    // Measured desktop user offsets
    offset: { desktop: { x: [-400, 0], y: [-600, 0] } },
    color: {
      ring: "ring-amber",
      background: "bg-amber",
      arrow: "text-amber",
    },
  },
  {
    id: "2",
    name: "Jean",
    email: "jean@terra.app",
    photo: `${IMG}/avatar-2`,
    permission: "Can read",
    align: "tl",
    offset: { desktop: { x: [400, 0], y: [-420, 0] } },
    color: {
      ring: "ring-orange",
      background: "bg-orange",
      arrow: "text-orange",
    },
  },
  {
    id: "3",
    name: "Niels",
    email: "niels@terra.app",
    photo: `${IMG}/avatar-3`,
    permission: "Can read",
    align: "tl",
    offset: { desktop: { x: [500, 100], y: [400, 100] } },
    color: {
      ring: "ring-indigo",
      background: "bg-indigo",
      arrow: "text-indigo",
    },
  },
  {
    id: "4",
    name: "Jeroen",
    email: "jeroen@terra.app",
    photo: `${IMG}/avatar-4`,
    permission: "Can edit",
    align: "tl",
    offset: { desktop: { x: [-1000, 0], y: [500, 0] } },
    color: {
      ring: "ring-green",
      background: "bg-green",
      arrow: "text-green",
    },
  },
];

export type FileItem = {
  id: string;
  label: string;
  subLabel: string;
};

// Components of the mapped repo, each with the evidence path it was derived
// from. Order/count/ids are load-bearing: the hero flight card shares a
// layoutId with the diagram hub.
// ponytail: card art still uses photo thumbs; swap file-*.png for
// filename/node cards when the demo visuals pass happens.
// Labels track `diagramNodes` — the later sections must not rename what the
// landing map just taught the visitor.
export const files: FileItem[] = [
  { id: "file-1", label: "Web App", subLabel: "web/src · 84 files" },
  { id: "file-2", label: "Request Handler", subLabel: "internal/api · 31 files" },
  { id: "file-3", label: "Scanner", subLabel: "internal/scan/walk.go" },
  { id: "file-4", label: "Analyzer", subLabel: "analyzer/terra_analyzer" },
  { id: "file-5", label: "GitHub", subLabel: "usememos/memos" },
  { id: "file-6", label: "Sign-in", subLabel: "internal/auth · 12 files" },
  { id: "file-7", label: "Notes", subLabel: "store/memo.go" },
  { id: "file-8", label: "Uploads", subLabel: "store/attachment.go" },
  { id: "file-9", label: "Storage", subLabel: "terra.db · schema v4" },
];

/** Hero/map architecture diagram — same components as `files`, human-readable. */
export type DiagramKind = "frontend" | "backend" | "data" | "service";

/** Same shape as `evidence` below, so the Evidence panel renders either one. */
export type DiagramFile = { path: string; why: string };

export type DiagramNode = {
  id: string;
  label: string;
  /** Plain-English sentence — the card's primary text, no jargon. */
  purpose: string;
  /** Short evidence path, revealed only when the node is focused. */
  hint: string;
  kind: DiagramKind;
  /** Column in the left→right flow: 0 = entry, 1 = the work, 2 = storage. */
  col: 0 | 1 | 2;
  /** Order within the column (and within its group box, if grouped). */
  row: number;
  /** Group box this node is stacked inside (see `diagramGroups`). */
  group?: string;
  /** Detected technologies — picks the card's tech tile (first match wins). */
  tech?: string[];
  files: DiagramFile[];
};

export type DiagramEdge = {
  from: string;
  to: string;
  label?: string;
};

/** Boxed groups in the flow — a labelled container the stacked nodes sit inside. */
export const diagramGroups = [
  { id: "backend", title: "Backend", hint: "internal/ · store/", col: 1 },
] as const;

export const diagramNodes: DiagramNode[] = [
  {
    id: "web",
    label: "Web App",
    purpose: "The screens people actually click on",
    hint: "web/src",
    kind: "frontend",
    col: 0,
    row: 0,
    tech: ["react", "typescript"],
    files: [
      { path: "web/src/pages/Home.tsx", why: "the screen people land on" },
      { path: "web/src/components", why: "buttons, lists and dialogs" },
    ],
  },
  {
    id: "auth",
    label: "Sign-in",
    purpose: "Checks who you are before anything runs",
    hint: "internal/auth",
    kind: "service",
    col: 1,
    row: 0,
    group: "backend",
    tech: ["go"],
    files: [
      { path: "internal/auth/token.go", why: "issues and checks sign-ins" },
      { path: "store/user.go", why: "the people it knows about" },
    ],
  },
  {
    id: "api",
    label: "Request Handler",
    purpose: "The switchboard — every request comes through here",
    hint: "internal/api",
    kind: "backend",
    col: 1,
    row: 1,
    group: "backend",
    tech: ["go", "grpc"],
    files: [
      { path: "internal/api/v1/memo_service.go", why: "every request enters here" },
      { path: "internal/api/v1/acl.go", why: "who is allowed to call what" },
    ],
  },
  {
    id: "memos",
    label: "Notes",
    purpose: "Keeps the notes people write",
    hint: "store/memo.go",
    kind: "backend",
    col: 1,
    row: 2,
    group: "backend",
    tech: ["go"],
    files: [
      { path: "store/memo.go", why: "reads and writes each note" },
      { path: "store/db/migration", why: "how a note is shaped" },
    ],
  },
  {
    id: "files",
    label: "Uploads",
    purpose: "Handles the pictures and files people attach",
    hint: "store/attachment.go",
    kind: "backend",
    col: 1,
    row: 3,
    group: "backend",
    tech: ["go"],
    files: [
      { path: "store/attachment.go", why: "stores an uploaded file" },
      { path: "internal/api/v1/attachment_service.go", why: "upload and download" },
    ],
  },
  {
    id: "db",
    label: "Storage",
    purpose: "Remembers everything, even after a restart",
    hint: "terra.db",
    kind: "data",
    col: 2,
    row: 0,
    tech: ["sqlite"],
    files: [
      { path: "store/db/sqlite/sqlite.go", why: "opens the database file" },
      { path: "terra.db", why: "the single file holding it all" },
    ],
  },
];

export const diagramEdges: DiagramEdge[] = [
  { from: "web", to: "api", label: "asks for" },
  { from: "api", to: "auth", label: "checks who you are" },
  { from: "api", to: "memos", label: "hands off notes" },
  // Deliberately unlabelled: this is the one edge routed as a detour around a
  // node it must not touch, so its caption would sit on the detour's elbow —
  // and "hands off notes" already makes the pattern obvious.
  { from: "api", to: "files" },
  { from: "memos", to: "db", label: "saves & reads" },
  { from: "files", to: "db" },
];

/** Smart section: faded window rises to 60% opacity (st variant). */
export const fadeRise = {
  hidden: { opacity: 0, y: 150 },
  show: { opacity: 0.6, y: 0, transition: spring },
} as const;

/** Intuitive preview pop — delayed shared-element style entrance. */
export const previewPop = {
  hidden: (centered: boolean) => ({
    opacity: 0,
    scale: 0.5,
    x: centered ? "-20%" : "-80%",
    y: centered ? "-60%" : "-50%",
  }),
  show: (centered: boolean) => ({
    opacity: 1,
    scale: 1,
    x: centered ? "-50%" : "-80%",
    y: "-50%",
  }),
} as const;

/** Citations shown in the Map section's Evidence panel. */
export const evidence = [
  { path: "app.py", why: "FastAPI service on :8010" },
  { path: "tasks/architecture.py", why: "agent task that builds the map" },
  { path: "schema.py", why: "enums + JSON schema, single source" },
  { path: "models.py", why: "Go wire contract" },
];

/** Where inference runs — anything OpenAI-compatible (see TERRA_LLM_URL). */
export const storage = [
  { id: "local", title: "Local", subtitle: "Qwen2.5-0.5B on this machine" },
  { id: "vllm", title: "vLLM", subtitle: "your own GPU box" },
  { id: "openai", title: "OpenAI-compatible", subtitle: "any /v1 endpoint" },
  { id: "ollama", title: "Ollama", subtitle: "OpenAI mode" },
];

export const copy = {
  /**
   * Lands as "Software that only engineers can understand", then `from` swaps
   * to `to` — the promise made by the headline rewriting itself rather than by
   * another sentence of copy.
   */
  heroTitle: {
    lead: "Software that only",
    from: "engineers",
    to: "humans",
    tail: "can understand",
  },
  heroSubtitle:
    "Terra clones your repository, scans it, and returns the components, how they connect, and the code that proves it.",
  powerTitle: "The power of Terra",
  power:
    "One map of your repo. Select any component, chat with it, and the change lands on the fly — no cloning, no local setup. Ask questions, implement with Terra in the loop, and monitor what the architecture says is alive.",
  /** Fallback demo clip when an op has no dedicated video. */
  opsVideo: "/videos/landing/ask-terra.mp4",
  ops: [
    {
      id: "ask",
      label: "Ask Terra",
      caption: "Plain-language answers grounded in the real map — not a chat that invents structure.",
    },
    {
      id: "implement",
      label: "Implement with Terra",
      caption: "Pick a component, say what you want, and the edit applies straight to the repo — Terra reads the wiring so it lands where the architecture says it should.",
    },
    {
      id: "monitor",
      label: "Monitor with Terra",
      caption: "Watch what the map says is alive — components, calls, and the evidence behind them.",
    },
  ] as const,
  trust:
    "Every claim links to the file that proves it. Inference runs against any OpenAI-compatible endpoint — including a model on your own laptop — so your code never has to leave.",
  /**
   * Bridge before Trust — same shape as `final` (two short lines, .sh-final width).
   * Closes the product pitch: the map exists so the whole team can ship too.
   */
  bridge: ["Work with coworkers", "who aren't engineers."],
  // Two lines, each ≤ ~18 chars: .sh-final is capped at 36rem (terra.css).
  final: ["The map your team", "can actually read."],
};
