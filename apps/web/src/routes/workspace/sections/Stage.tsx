import { useState, type ClipboardEvent, type DragEvent } from "react";
import type { TerraMap } from "../../../features/architecture-map";
import type { LiveSelection } from "../../../features/preview";
import type { useAnalyze } from "../useAnalyze";
import { extractGitHubURL, githubURLFromDataTransfer } from "../githubUrl";
import { StatusLine } from "../../../shared/shell/StatusLine";
import { WsDropCard } from "../../../shared/shell/DropCard";
import { RepoForm } from "../../../shared/shell/RepoForm";
import { MapStage } from "./MapStage";
import { ModelGate } from "./ModelGate";
import type { ModelChoice } from "../../../features/analysis";

/** Centre column: drop / mapping / map. */
export function DropStage({
  analyze,
  map,
  selectedIds,
  onSelect,
  onElements,
  onModel,
}: {
  analyze: ReturnType<typeof useAnalyze>;
  map: TerraMap | null;
  selectedIds: string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  onElements: (picked: LiveSelection[]) => void;
  onModel: (choice: ModelChoice) => void;
}) {
  const [over, setOver] = useState(false);
  /** What a drop put in the field, so the intake shows what it is about to map. */
  const [dropped, setDropped] = useState("");
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const { start, proceed, cancel, status, error, running, elapsed, partial, recommendation } =
    analyze;

  const begin = (repo: string) => {
    setIntakeError(null);
    setDropped(repo);
    start(repo);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (running) return;
    const repo = githubURLFromDataTransfer(e.dataTransfer);
    if (!repo) {
      setIntakeError("Drop a GitHub repository URL (github.com/owner/repo)");
      return;
    }
    begin(repo);
  };

  const onPaste = (e: ClipboardEvent) => {
    if (running || map) return;
    const text = e.clipboardData.getData("text/plain");
    const repo = extractGitHubURL(text);
    if (!repo) return;
    e.preventDefault();
    begin(repo);
  };

  const mapped = !!map && !recommendation;

  return (
    <main className={`sh-ws__stage${mapped ? " is-map" : ""}`}>
      {recommendation ? (
        <ModelGate
          recommendation={recommendation}
          onContinue={(modelId, apiKey, provider) => {
            onModel({ modelId, apiKey });
            proceed(modelId, apiKey, provider);
          }}
          onCancel={cancel}
        />
      ) : map ? (
        <>
          <MapStage map={map} selectedIds={selectedIds} onSelect={onSelect} onElements={onElements} />
          {running && (
            <div className="sh-ws__mapping-bar" aria-live="polite">
              <StatusLine
                label={status?.label ?? (partial ? "Terra is reading the architecture" : "Working")}
                elapsed={elapsed}
              />
              <button type="button" className="sh-ws__stop" onClick={cancel}>
                Stop
              </button>
            </div>
          )}
        </>
      ) : running ? (
        <div className="sh-ws__running">
          <StatusLine label={status?.label ?? "Starting"} elapsed={elapsed} />
          <button type="button" className="sh-ws__stop" onClick={cancel}>
            Stop
          </button>
          {error && <p className="sh-ws__error">{error}</p>}
        </div>
      ) : (
        /* Drop target and field are one panel: the two halves of a single
           instruction, not a card with a stray form under it. */
        <div className="sh-ws__intake">
          <WsDropCard
            over={over}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onPaste={onPaste}
          />
          <RepoForm
            busy={running}
            seed={dropped}
            onSubmit={(raw) => begin(extractGitHubURL(raw) ?? raw)}
            label="GitHub repository URL"
          />
          {(intakeError || error) && <p className="sh-ws__error">{intakeError ?? error}</p>}
        </div>
      )}
    </main>
  );
}
