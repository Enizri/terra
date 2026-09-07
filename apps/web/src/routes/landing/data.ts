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
  { id: "file-5", label: "GitHub", subLabel: "terra/terra" },
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
  heroEyebrow: "A map of any GitHub repo.",
  heroHeadline: "See the whole codebase. Then ask it anything.",
  /** Two-tone split used by the parked `HeroChars` globe hero. Distinct from
      `heroTitle`, which feeds the word-swap headline in `sections/Hero.tsx`. */
  heroHeadlineParts: {
    lead: "See the whole codebase.",
    muted: "Then ask it anything.",
  },
  heroSubtitle:
    "Terra turns a repository into a readable architecture map — components, how they connect, and the files that prove it. Then you can ask the map and run the software.",
  /** Wrapped around the hero globe as one glyph per cell. Away from the
      cursor the field is scrambled; the lens reconstitutes this stream so
      functions, classes and library calls from several languages read as
      code rather than as noise. */
  heroGlobeText: [
    "func Handle(w http.ResponseWriter, r *http.Request) error · ",
    "export function useState<T>(init: T): [T, Dispatch<T>] · ",
    "class Component extends React.Component<Props, State> · ",
    "def __init__(self, repo: str) -> None: · ",
    "impl Display for Terra { fn fmt(&self, f: &mut Formatter) · ",
    "from flask import Flask, jsonify · ",
    "const [repo, setRepo] = useState<string | null>(null) · ",
    "fn main() { let map = Terra::load(path)?; · ",
    "SELECT id, name FROM components WHERE live = 1 · ",
    "import { motion } from \"motion/react\" · ",
    "pub async fn map_repo(path: PathBuf) -> Result<Map> · ",
    "interface Node { kind: string; files: string[] } · ",
    "go func(ctx context.Context) error { return s.Listen(ctx) } · ",
    "useEffect(() => { void load(repo) }, [repo]) · ",
    "fmt.Errorf(\"clone failed: %w\", err) · ",
    "struct Server { addr string `json:\"addr\"` } · ",
    "type Props = { id: string; onMap: (n: Node) => void } · ",
    "match node { Some(n) => n.kind, None => \"\" } · ",
    "std::vector<Component> tree; tree.push_back(root); · ",
    "export default function Page(): React.FC<Props> · ",
    "class UserService implements Repository { findById(id) · ",
    "pandas.DataFrame.from_records(rows).groupby(\"kind\") · ",
    "numpy.ndarray; torch.nn.Linear(128, 64) · ",
    "tokio::spawn(async move { map.apply(diff).await }) · ",
    "sqlx::query(\"SELECT * FROM files WHERE path = $1\") · ",
    "@Component({ selector: \"app-root\" }) class App {} · ",
    "func (s *Store) Get(ctx context.Context, id ID) (*Node, error) · ",
    "extension View { var body: some View { Content() } } · ",
    "package main; import \"fmt\"; func main() { fmt.Println(m) } · ",
    "using System.Linq; class Program { static async Task Main() · ",
    "def train(model, epochs=10): for x in loader: loss.backward() · ",
    "git.clone(url).then(analyze); cargo test --lib · ",
    "query Repo($id: ID!) { repo(id: $id) { nodes { name } } } · ",
    ".sh-hero { display: grid; place-items: center } · ",
    "<section className=\"hero\"><canvas aria-hidden /></section> · ",
    "ONE MAP OF YOUR REPO · ASK IT ANYTHING · SHIP ON THE FLY · ",
  ].join(""),
  heroCta: {
    primary: { label: "Get started", href: "/new" },
    secondary: { label: "See how teams use Terra", href: "#power" },
  },
  /** Capture of one full pass of the scripted hero's inner card: scan, map,
      preview, and the closing chat. Poster-first — see `HeroDemo`. */
  heroDemo: {
    src: "/videos/landing/workspace-demo.mp4",
    poster: "/videos/landing/workspace-demo-poster.jpg",
    play: "Play the Terra workspace demo",
    alt: "The Terra workspace showing the mapped architecture of the memos repository",
    caption: "A scripted walkthrough: load a repo, explore its map, open the app preview, and ask for a change.",
  },
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
    {
      id: "map",
      label: "Map",
      caption: "The architecture of your repo, read straight from the code — every part linked to the files that prove it.",
    },
    {
      id: "collaborate",
      label: "Collaborate with Terra",
      caption:
        "Your whole team can change the live software together — same repo, same moment. Terra takes care of the conflicts so nobody overwrites anyone else.",
    },
  ] as const,
  // ≤ ~18 chars/line; .sh-final capped at 36rem.
  final: ["The map your team", "can actually read."],
};

/** Fake live spans for the Power of Terra Monitor tab (marketing only). */
export const MONITOR_DEMO_SPANS = [
  { method: "GET", path: "/api/v1/notes", status: "200", component: "Notes", ms: "18ms" },
  { method: "POST", path: "/api/v1/auth/signin", status: "200", component: "Sign-in", ms: "42ms" },
  { method: "GET", path: "/api/v1/notes:search", status: "200", component: "Web App", ms: "31ms" },
  { method: "POST", path: "/api/v1/notes", status: "201", component: "Notes", ms: "27ms" },
  { method: "GET", path: "/api/v1/attachments", status: "200", component: "Uploads", ms: "22ms" },
  { method: "DELETE", path: "/api/v1/notes/42", status: "204", component: "Notes", ms: "15ms" },
  { method: "GET", path: "/api/v1/users/me", status: "200", component: "Sign-in", ms: "12ms" },
  { method: "POST", path: "/api/v1/attachments", status: "201", component: "Uploads", ms: "88ms" },
] as const;

export const faq = {
  eyebrow: "Questions",
  title: "Fair questions.",
  items: [
    {
      q: "What is Terra?",
      a: "A map of your repo that you can talk to. Drop it on the playground — Terra clones it, sets it up, and runs it. Frontends you change live; desktop, mobile, and heavier edits are next. Need keys? Terra asks in the UI and stores them on your machine.",
    },
    {
      q: "Does my code leave my machine?",
      a: "Not on the free path — the model runs locally. Stronger hosted models are opt-in. Nothing is written back until you approve a diff.",
    },
    {
      q: "What does it cost?",
      a: "Free on your machine. Credits are for higher usage and stronger models.",
    },
    {
      q: "Which languages does it read?",
      a: "Whatever is in the repo. It classifies the files — Go, Python, TypeScript, Rust, Java, and the rest of a normal stack — then maps from those facts, not from a language-specific parser.",
    },
    {
      q: "Can it change things without me?",
      a: "No. Every change arrives as a diff and a preview. A human merges.",
    },
    {
      q: "Is this a replacement for my IDE?",
      a: "No. It's the layer above it — and a faster way to clone someone else's repo and actually understand it.",
    },
  ],
};

export const footer = {
  headline: ["One map of", "your repo."],
  cta: { label: "Get started", href: "/new" },
  tagline: "One map of your repo. A human approves every merge.",
  /** `#` is a placeholder the click handler swallows — a page that does not
      exist yet. A leading `/` is a real route; only an absolute URL leaves the
      site. */
  cols: [
    {
      title: "Product",
      links: [
        { label: "Changelog", href: "#" },
        { label: "About us", href: "/about" },
        { label: "GitHub", href: "https://github.com/Enizri/terra" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: "#" },
        { label: "Terms", href: "#" },
      ],
    },
  ],
};
