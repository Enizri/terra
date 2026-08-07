import { useCallback, useEffect, useRef, useState } from "react";
import type { TerraMap } from "../../shared/map/types";
import { analyze, type AnalyzeEvent } from "../../shared/api";

/** Analyze job: enqueue + event stream; keep only the latest stage. */
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
      for await (const ev of analyze(repoUrl, ac.signal)) {
        setStatus(ev);
        if (ev.stage === "done" && ev.map) setMap(ev.map);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setRunning(false);
    }
  }, []);

  // The stream loop's finally skips setRunning after an abort (its guard is
  // for unmount); reset state here so the form doesn't stay disabled.
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setStatus(null);
  }, []);

  return { start, cancel, status, map, error, running, elapsed };
}
