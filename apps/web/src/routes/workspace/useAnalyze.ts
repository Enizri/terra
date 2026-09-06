import { useCallback, useEffect, useRef, useState } from "react";
import type { TerraMap } from "../../features/architecture-map";
import {
  analyze,
  probe,
  clearApiKey,
  isAuthFailure,
  type AnalyzeEvent,
  type Recommendation,
} from "../../features/analysis";
import { wsCache } from "./cache";

/**
 * Two-phase analyze. `start` runs the probe — fetch, scan, recommend — and
 * paints the structural map, then stops at a hard gate. `proceed` runs the
 * LLM half with the model the user chose.
 *
 * A probe that hits the stored-map cache never opens the gate: there is no
 * LLM run left to configure, so `done` just lands the map.
 */
export function useAnalyze() {
  const [status, setStatus] = useState<AnalyzeEvent | null>(null);
  // Seed from the cache so remounts show the last map instead of refetching.
  const [map, setMap] = useState<TerraMap | null>(wsCache.map);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** True after a structural/partial map until the final done event. */
  const [partial, setPartial] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /** Set when the probe finished and the user must pick a model. */
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const repoRef = useRef<string>("");
  const probeIdRef = useRef<string>("");
  /** The recommendation the gate was showing, so a rejected key can reopen it. */
  const gateRef = useRef<Recommendation | null>(null);

  // Abort in flight work on unmount so a late chunk can't set state.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  /** Drains one job stream into the shared status/map state. onError lets
   * the analyze phase react to a rejected key. */
  const consume = useCallback(
    async (
      stream: AsyncGenerator<AnalyzeEvent>,
      ac: AbortController,
      onError?: (message: string) => void,
    ) => {
      try {
        for await (const ev of stream) {
          setStatus(ev);
          if (ev.probe_id) probeIdRef.current = ev.probe_id;
          if (ev.map) {
            wsCache.map = ev.map;
            setMap(ev.map);
            setPartial(ev.stage !== "done");
          }
          if (ev.stage === "done" && ev.recommendation) {
            setRecommendation(ev.recommendation);
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const message = (e as Error).message;
        setError(message);
        onError?.(message);
        // Keep any structural map that already landed — blanking would undo
        // the speed-to-understanding win when the LLM pass fails.
        setPartial(false);
      } finally {
        if (!ac.signal.aborted) setRunning(false);
      }
    },
    [],
  );

  const start = useCallback(
    async (repoUrl: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      repoRef.current = repoUrl;
      probeIdRef.current = "";

      setStatus(null);
      setMap(null);
      // Keep cache and state in sync: a failed run must not resurrect the
      // previous map on the next remount.
      wsCache.map = null;
      setError(null);
      setPartial(false);
      setRecommendation(null);
      setElapsed(0);
      setRunning(true);

      await consume(probe(repoUrl, ac.signal), ac);
    },
    [consume],
  );

  /** Past the gate: run the LLM half with the chosen model. */
  const proceed = useCallback(
    async (modelId: string, apiKey?: string, provider?: string) => {
      const repoUrl = repoRef.current;
      if (!repoUrl) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      // The choice is the session's model: Ask reuses it.
      gateRef.current = recommendation;
      wsCache.selectedModel = { modelId, apiKey, provider };
      setRecommendation(null);
      setError(null);
      setElapsed(0);
      setRunning(true);

      const gate = gateRef.current;
      await consume(
        analyze({ repoUrl, probeId: probeIdRef.current, modelId, apiKey }, ac.signal),
        ac,
        (message) => {
          // The provider rejected the key: forget it and reopen the picker
          // rather than letting the user retry the same dead credential.
          if (!provider || !isAuthFailure(message)) return;
          clearApiKey(provider);
          wsCache.selectedModel = null;
          setRecommendation(gate);
        },
      );
    },
    [consume, recommendation],
  );

  // The stream loop's finally skips setRunning after an abort (its guard is
  // for unmount); reset state here so the form doesn't stay disabled.
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setStatus(null);
    setPartial(false);
    setRecommendation(null);
  }, []);

  return { start, proceed, cancel, status, map, error, running, partial, elapsed, recommendation };
}
