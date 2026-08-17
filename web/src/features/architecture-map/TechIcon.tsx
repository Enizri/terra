/** Tech tile for a diagram card; unknown tech falls back to kind-tinted initial. */

import type { DiagramKind } from "./diagramViews";

type Spec = { bg: string; fg: string; text: string };

const SPECS: Record<string, Spec> = {
  typescript: { bg: "#3178c6", fg: "#fff", text: "TS" },
  javascript: { bg: "#f7df1e", fg: "#1c1c1c", text: "JS" },
  go: { bg: "#00add8", fg: "#fff", text: "Go" },
  python: { bg: "#3776ab", fg: "#ffd343", text: "Py" },
  rust: { bg: "#232323", fg: "#e43717", text: "Rs" },
  node: { bg: "#5fa04e", fg: "#fff", text: "No" },
  postgres: { bg: "#4169a1", fg: "#fff", text: "Pg" },
  sqlite: { bg: "#0f80cc", fg: "#fff", text: "SQ" },
  mysql: { bg: "#00758f", fg: "#fff", text: "My" },
  redis: { bg: "#d82c20", fg: "#fff", text: "Re" },
  docker: { bg: "#2496ed", fg: "#fff", text: "Dk" },
  vite: { bg: "#9575ff", fg: "#ffd029", text: "V" },
  grpc: { bg: "#2ca1aa", fg: "#fff", text: "gR" },
  protobuf: { bg: "#4a6da7", fg: "#fff", text: "Pb" },
};

const ALIAS: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  golang: "go",
  nodejs: "node",
  "node.js": "node",
  postgresql: "postgres",
  sqlite3: "sqlite",
  "protocol buffers": "protobuf",
  proto: "protobuf",
};

const KIND_BG: Record<DiagramKind, string> = {
  frontend: "#ff6e37",
  backend: "#0077ff",
  service: "#7c5cff",
  data: "#12b886",
};

function resolve(tech?: string[]): Spec | null {
  for (const raw of tech ?? []) {
    const key = raw.trim().toLowerCase();
    const spec = SPECS[ALIAS[key] ?? key];
    if (spec) return spec;
  }
  return null;
}

/** React's atom: the one mark letters can't fake. */
const ReactAtom = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="2" fill="#61dafb" />
    <g fill="none" stroke="#61dafb" strokeWidth="1.2">
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
    </g>
  </svg>
);

export default function TechIcon({
  tech,
  kind,
  label,
}: {
  tech?: string[];
  kind: DiagramKind;
  label: string;
}) {
  const first = (tech ?? []).map((t) => ALIAS[t.trim().toLowerCase()] ?? t.trim().toLowerCase());
  if (first.includes("react")) {
    return (
      <span className="sh-diagram__icon" style={{ background: "#23272f" }} aria-hidden>
        <ReactAtom />
      </span>
    );
  }
  const spec = resolve(tech);
  if (spec) {
    return (
      <span
        className="sh-diagram__icon"
        style={{ background: spec.bg, color: spec.fg }}
        aria-hidden
      >
        {spec.text}
      </span>
    );
  }
  return (
    <span
      className="sh-diagram__icon sh-diagram__icon--fallback"
      style={{ background: KIND_BG[kind] }}
      aria-hidden
    >
      {(label[0] ?? "?").toUpperCase()}
    </span>
  );
}
