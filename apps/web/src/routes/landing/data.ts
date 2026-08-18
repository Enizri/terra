export const IMG = "/terra/images";

/** Repo whose real frontend the theater previews live (via terra serve). */
export const REPO_URL = "github.com/usememos/memos";
/** Diagram node that gets the live preview instead of a replica. */
export const LIVE_NODE_ID = "web";

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
    name: "Evyatar",
    email: "evyatar@terra.app",
    photo: `${IMG}/collaborator-evyatar`,
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
    name: "Maya",
    email: "maya@terra.app",
    photo: `${IMG}/collaborator-maya`,
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
    id: "3",
    name: "Leo",
    email: "leo@terra.app",
    photo: `${IMG}/collaborator-leo`,
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

// Order/ids are load-bearing: hero flight card shares layoutId with diagram hub.
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

export type DiagramKind = "frontend" | "backend" | "data" | "service";

export type DiagramNode = {
  id: string;
  label: string;
  purpose: string;
  hint: string;
  kind: DiagramKind;
  col: 0 | 1 | 2;
  row: number;
  group?: string;
  tech?: string[];
};

export type DiagramEdge = {
  from: string;
  to: string;
  label?: string;
};

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
  },
];

export const diagramEdges: DiagramEdge[] = [
  { from: "web", to: "api", label: "asks for" },
  { from: "api", to: "auth", label: "checks who you are" },
  { from: "api", to: "memos", label: "hands off notes" },
  // Unlabelled detour edge — caption would sit on the elbow.
  { from: "api", to: "files" },
  { from: "memos", to: "db", label: "saves & reads" },
  { from: "files", to: "db" },
];

export const evidence = [
  { path: "app.py", why: "FastAPI service on :8010" },
  { path: "tasks/architecture.py", why: "analyzer task that builds the map" },
  { path: "schema.py", why: "enums + JSON schema, single source" },
  { path: "models.py", why: "Go wire contract" },
];

export const storage = [
  { id: "local", title: "Local", subtitle: "Qwen2.5-0.5B on this machine" },
  { id: "vllm", title: "vLLM", subtitle: "your own GPU box" },
  { id: "openai", title: "OpenAI-compatible", subtitle: "any /v1 endpoint" },
  { id: "ollama", title: "Ollama", subtitle: "OpenAI mode" },
];

export const copy = {
  heroTitle: {
    lead: "Software that only",
    from: "engineers",
    to: "humans",
    tail: "can understand",
  },
  heroSubtitle:
    "Terra maps your repo, then runs it in the cloud so you can change the live software — no local setup.",
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
    "Your whole team can change the live software together — same repo, same moment. Terra takes care of the conflicts so nobody overwrites anyone else.",
  bridge: ["Work with coworkers", "who aren't engineers."],
  // ≤ ~18 chars/line; .sh-final capped at 36rem.
  final: ["The map your team", "can actually read."],
};

/** Fake live spans for the Power of Terra Monitor tab (marketing only). */
export const MONITOR_DEMO_SPANS = [
  { method: "GET", path: "/api/v1/memos", status: "200", component: "Notes", ms: "18ms" },
  { method: "POST", path: "/api/v1/auth/signin", status: "200", component: "Sign-in", ms: "42ms" },
  { method: "GET", path: "/api/v1/memos:search", status: "200", component: "Web App", ms: "31ms" },
  { method: "POST", path: "/api/v1/memos", status: "201", component: "Notes", ms: "27ms" },
  { method: "GET", path: "/api/v1/attachments", status: "200", component: "Uploads", ms: "22ms" },
  { method: "DELETE", path: "/api/v1/memos/42", status: "204", component: "Notes", ms: "15ms" },
  { method: "GET", path: "/api/v1/users/me", status: "200", component: "Sign-in", ms: "12ms" },
  { method: "POST", path: "/api/v1/attachments", status: "201", component: "Uploads", ms: "88ms" },
] as const;
