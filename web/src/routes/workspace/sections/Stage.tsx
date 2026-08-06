import { useState, type DragEvent, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { TerraMap } from "../../../shared/map/types";
import type { LiveSelection } from "../../../shared/live";
import type { useAnalyze } from "../useAnalyze";
import { ArrowIcon, RepoIcon } from "../icons";
import { MapStage } from "./MapStage";

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Single evolving status line. */
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

/** Centre column: drop / mapping / map. */
export function DropStage({
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
    if (!repo || running) return;
    start(repo);
  };

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
