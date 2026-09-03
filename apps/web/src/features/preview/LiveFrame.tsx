/** Live-preview iframe + selection shapes posted by select.js. */
import { useEffect, useState, type RefObject } from "react";
import { previewEvents, type PreviewApp, type PreviewResult } from "./api.ts";
import { PackageStage } from "./PackageStage.tsx";
import { CliStage } from "./CliStage.tsx";

/** Shape select.js posts on click. */
export type LiveSelection = {
  name?: string;
  ownerChain?: string[];
  file?: string;
  line?: number | null;
  tag?: string;
  text?: string;
};

export function selectionLabel(sel: LiveSelection): string {
  return sel.name ?? sel.tag ?? "element";
}

export function liveSelectionId(sel: LiveSelection): string {
  return [sel.name ?? "", sel.file ?? "", String(sel.line ?? ""), sel.tag ?? "", (sel.text ?? "").slice(0, 40)].join("|");
}

export function LiveFrame({
  picking: pickingProp,
  frameRef,
  repoUrl,
}: {
  picking?: boolean;
  frameRef: RefObject<HTMLIFrameElement | null>;
  repoUrl: string;
}) {
  const [picking, setPicking] = useState(pickingProp ?? true);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [activeId, setActiveId] = useState("");
  const [progress, setProgress] = useState("Starting the dev server… first run can take a few minutes.");
  const [error, setError] = useState("");

  useEffect(() => {
    if (pickingProp !== undefined) setPicking(pickingProp);
  }, [pickingProp]);

  useEffect(() => {
    const ac = new AbortController();
    setResult(null);
    setActiveId("");
    setError("");
    setProgress("Starting the dev server… first run can take a few minutes.");
    void (async () => {
      try {
        for await (const ev of previewEvents(repoUrl, ac.signal)) {
          if (ev.label) setProgress(ev.label);
          if (ev.preview) {
            setResult(ev.preview);
            setActiveId(ev.preview.primary_id || ev.preview.apps.find((a) => a.status === "ready")?.id || "");
          }
        }
      } catch (e) {
        const err = e as Error;
        if (err.name !== "AbortError") setError(err.message);
      }
    })();
    return () => ac.abort();
  }, [repoUrl]);

  const sendMode = () => {
    frameRef.current?.contentWindow?.postMessage({ type: "terra:mode", picking }, "*");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(sendMode, [picking]);

  const active = result?.apps.find((a) => a.id === activeId);
  const url = active?.url || result?.url || "";
  const apps = result?.apps ?? [];
  const packageView = !url && !error && result != null && apps.some((a) => a.status === "ready");
  const cliView = packageView && (active?.kind || result?.apps[0]?.kind) === "cli";

  return (
    <div className="sh-live-shell">
      <div className="sh-live-bar">
        <div className="sh-live-apps" role="list">
          {apps.map((app) => (
            <AppChip key={app.id} app={app} active={app.id === activeId} onSelect={setActiveId} />
          ))}
        </div>
        {!packageView && (
          <button
            type="button"
            className={`sh-live-mode${picking ? " is-select" : " is-interact"}`}
            onClick={() => setPicking((p) => !p)}
          >
            {picking ? "Select" : "Interact"}
          </button>
        )}
      </div>
      {error ? (
        <div className="sh-live__status sh-live__status--error">Preview failed: {error}</div>
      ) : cliView ? (
        <CliStage repoUrl={repoUrl} reason={active?.reason || result?.apps[0]?.reason} />
      ) : packageView ? (
        <PackageStage repoUrl={repoUrl} reason={active?.reason || result?.apps[0]?.reason} />
      ) : !url ? (
        <div className="sh-live__status">{progress}</div>
      ) : (
        <iframe ref={frameRef} className="sh-live" src={url} onLoad={sendMode} title="Live preview" />
      )}
    </div>
  );
}

function AppChip({
  app,
  active,
  onSelect,
}: {
  app: PreviewApp;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const skipped = app.status === "skipped" || app.status === "error";
  return (
    <button
      type="button"
      role="listitem"
      className={`sh-live-app${active ? " is-on" : ""}${skipped ? " is-off" : ""}`}
      disabled={skipped}
      title={skipped ? app.reason || "Cannot preview this app" : app.name}
      onClick={() => onSelect(app.id)}
    >
      <b>{app.name || app.id}</b>
      <em>{skipped ? app.reason || app.status : app.kind}</em>
    </button>
  );
}
