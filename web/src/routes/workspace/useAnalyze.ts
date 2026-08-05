import { useCallback, useEffect, useRef, useState } from "react";
import type { TerraMap } from "../../shared/map/types";
import { ndjsonSplitter } from "../../shared/ndjson";

export type AnalyzeEvent = {
  stage: "clone" | "scan" | "analyze" | "store" | "done" | "error";
  label?: string;
  map?: TerraMap;
};

/**
 * Drives POST /analyze in its NDJSON mode. Only the latest stage is kept —
 * the UI shows one evolving line, not a growing log.
 */
export function useAnalyze() {
  const [status, setStatus] = useState<AnalyzeEvent | null>(null);
  const [map, setMap] = useState<TerraMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Abort in flight work on unmount so a late chunk can't set state.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback(async (repoUrl: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus(null);
    setMap(null);
    setError(null);
    setElapsed(0);
    setRunning(true);

    try {
      const res = await fetch("/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ repo_url: repoUrl }),
        signal: ac.signal,
      });

      // A rejected URL never reaches the stream — it comes back as {"error"}.
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `analyze failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const feed = ndjsonSplitter<AnalyzeEvent>();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const ev of feed(decoder.decode(value, { stream: true }))) {
          if (ev.stage === "error") throw new Error(ev.label ?? "analysis failed");
          setStatus(ev);
          if (ev.stage === "done" && ev.map) setMap(ev.map);
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setRunning(false);
    }
  }, []);

  return { start, status, map, error, running, elapsed };
}
