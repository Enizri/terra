/** README + test log when the repo has no HTTP UI to iframe. */
import { useEffect, useState } from "react";
import { previewTestEvents, repoReadme } from "./api.ts";

export function PackageStage({ repoUrl, reason }: { repoUrl: string; reason?: string }) {
  const [readme, setReadme] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [log, setLog] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    void repoReadme(repoUrl, ac.signal)
      .then((text) => {
        if (!ac.signal.aborted) setReadme(text);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [repoUrl]);

  const runTests = () => {
    const ac = new AbortController();
    setRunning(true);
    setLog("");
    void (async () => {
      try {
        for await (const ev of previewTestEvents(repoUrl, ac.signal)) {
          if (ev.label) setLog(ev.label);
        }
      } catch (e) {
        const err = e as Error;
        if (err.name !== "AbortError") setLog(err.message);
      } finally {
        setRunning(false);
      }
    })();
  };

  return (
    <div className="sh-live-pack">
      <p className="sh-live-pack__why">{reason || "This repository has no web UI to embed."}</p>
      {loading ? (
        <p className="sh-live__status">Reading the repository…</p>
      ) : readme ? (
        <pre className="sh-live-pack__readme">{readme}</pre>
      ) : (
        <p className="sh-live__status">No README in this checkout. Terra found no app to boot.</p>
      )}
      <div className="sh-live-pack__tests">
        <button type="button" className="sh-chip sh-chip--btn" disabled={running} onClick={runTests}>
          {running ? "Running tests…" : "Run tests"}
        </button>
        {log ? <pre className="sh-live-pack__log">{log}</pre> : null}
      </div>
    </div>
  );
}
