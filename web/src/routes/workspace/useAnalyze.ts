import { useCallback, useEffect, useRef, useState } from "react";
import type { TerraMap } from "../../shared/map/types";
import { analyze, type AnalyzeEvent } from "../../shared/api";
import { wsCache } from "./cache";

/** Analyze job: enqueue + event stream; paint map as soon as scan emits one. */
export function useAnalyze() {
  const [status, setStatus] = useState<AnalyzeEvent | null>(null);
  // Seed from the cache so remounts show the last map instead of refetching.
  const [map, setMap] = useState<TerraMap | null>(wsCache.map);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** True after a structural/partial map until the final done event. */
  const [partial, setPartial] = useState(false);
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
    // Keep cache and state in sync: a failed run must not resurrect the
    // previous map on the next remount.
    wsCache.map = null;
    setError(null);
    setPartial(false);
    setElapsed(0);
    setRunning(true);

    try {
      for await (const ev of analyze(repoUrl, ac.signal)) {
        setStatus(ev);
        if (ev.map) {
          wsCache.map = ev.map;
          setMap(ev.map);
          if (ev.stage === "done") {
            setPartial(false);
          } else {
            setPartial(true);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
      // Keep any structural map that already landed — blanking would undo
      // the speed-to-understanding win when the LLM pass fails.
      setPartial(false);
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
    setPartial(false);
  }, []);

  return { start, cancel, status, map, error, running, partial, elapsed };
}
