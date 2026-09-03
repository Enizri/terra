import { useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import type { TerraMap } from "../../../features/architecture-map";
import type { LiveSelection } from "../../../features/preview";
import type { useAnalyze } from "../useAnalyze";
import { githubURLFromDataTransfer, parseGitHubURL, discardedRefNote } from "../githubUrl";
import { ArrowIcon } from "../../../shared/shell/icons";
import { StatusLine } from "../../../shared/shell/StatusLine";
import { WsDropCard } from "../../../shared/shell/DropCard";
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
  const [url, setUrl] = useState("");
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeNote, setIntakeNote] = useState<string | null>(null);
  const { start, proceed, cancel, status, error, running, elapsed, partial, recommendation } =
    analyze;

  const begin = (repo: string, note?: string | null) => {
    setIntakeError(null);
    setIntakeNote(note ?? null);
    setUrl(repo);
    start(repo);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const repo = url.trim();
    if (!repo || running) return;
    const parsed = parseGitHubURL(repo);
    begin(parsed?.url ?? repo, parsed ? discardedRefNote(parsed) : null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (running) return;
    const parsed = githubURLFromDataTransfer(e.dataTransfer);
    if (!parsed) {
      setIntakeError("Drop a GitHub repository URL (github.com/owner/repo)");
      return;
    }
    begin(parsed.url, discardedRefNote(parsed));
  };

  const onPaste = (e: ClipboardEvent) => {
    if (running || map) return;
    const text = e.clipboardData.getData("text/plain");
    const parsed = parseGitHubURL(text);
    if (!parsed) return;
    e.preventDefault();
    begin(parsed.url, discardedRefNote(parsed));
  };

  return (
    <main className={`sh-ws__stage${map && !recommendation ? " is-map" : ""}`}>
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
        </div>
      ) : (
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
      )}

      {(intakeNote || intakeError || error) && (
        <p className={intakeError || error ? "sh-ws__error" : "sh-ws__note"}>
          {intakeError ?? error ?? intakeNote}
        </p>
      )}

      <form className="sh-ws__url" onSubmit={submit}>
        <input
          className="sh-ws__input"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setIntakeError(null);
            setIntakeNote(null);
          }}
          placeholder="github.com/terra/terra"
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
