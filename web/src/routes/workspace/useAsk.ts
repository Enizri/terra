import { useCallback, useEffect, useRef, useState } from "react";
import { ask as askServer, type Selection } from "../../shared/api";
import {
  buildProcess,
  advanceProcess,
  completeProcess,
  updateTerraParts,
  hasMeaningfulSelection,
  type AskMessage,
  type AskPart,
} from "./askProcess.ts";

export type { AskMessage, AskPart, ProcessStep, ProcessStepStatus } from "./askProcess.ts";

const THINKING_COPY = "Considering the map and what you selected…";

/**
 * Drives an ask job for one repo. Client stages thinking + process parts so
 * the dock can look Claude-like while the job runs; abort cancels the job.
 */
export function useAsk(repoUrl: string | null) {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // A ref, not `thinking`: the callback is stable, so its closure would hold a
  // stale value and let a fast second click double-send.
  const busyRef = useRef(false);
  const stageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearStageTimer = () => {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  };

  useEffect(() => () => {
    abortRef.current?.abort();
    clearStageTimer();
  }, []);

  // A second repo in the same workspace starts a new conversation — and the
  // previous repo's answer must not land in it.
  useEffect(() => {
    abortRef.current?.abort();
    clearStageTimer();
    setMessages([]);
    setThinking(false);
    busyRef.current = false;
  }, [repoUrl]);

  const ask = useCallback(
    async (question: string, selection?: Selection, selections?: Selection[]) => {
      const q = question.trim();
      if (!q || !repoUrl || busyRef.current) return;

      abortRef.current?.abort();
      clearStageTimer();
      const ac = new AbortController();
      abortRef.current = ac;
      busyRef.current = true;

      const scoped = hasMeaningfulSelection(selection, selections);
      const terraParts: AskPart[] = [
        { type: "thinking", text: THINKING_COPY, done: false },
        { type: "process", steps: buildProcess(scoped) },
      ];

      setMessages((m) => [
        ...m,
        { role: "user", parts: [{ type: "text", text: q }] },
        { role: "terra", parts: terraParts },
      ]);
      setThinking(true);

      // Advance process steps while /ask is in flight (client-staged, not tools).
      stageTimerRef.current = setInterval(() => {
        setMessages((msgs) => {
          const idx = msgs.length - 1;
          if (idx < 0 || msgs[idx].role !== "terra") return msgs;
          return updateTerraParts(msgs, idx, (parts) =>
            parts.map((p) =>
              p.type === "process" ? { ...p, steps: advanceProcess(p.steps) } : p,
            ),
          );
        });
      }, 700);

      try {
        const answer = await askServer(repoUrl, q, selections ?? (selection ? [selection] : []), ac.signal);
        clearStageTimer();
        setMessages((msgs) => {
          const idx = msgs.length - 1;
          if (idx < 0 || msgs[idx].role !== "terra") {
            return [...msgs, { role: "terra", parts: [{ type: "text", text: answer }] }];
          }
          return updateTerraParts(msgs, idx, (parts) => [
            ...parts.map((p) => {
              if (p.type === "thinking") return { ...p, done: true };
              if (p.type === "process") return { ...p, steps: completeProcess(p.steps) };
              return p;
            }),
            { type: "text" as const, text: answer },
          ]);
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        clearStageTimer();
        const text = (e as Error).message;
        setMessages((msgs) => {
          const idx = msgs.length - 1;
          if (idx < 0 || msgs[idx].role !== "terra") {
            return [...msgs, { role: "terra", parts: [{ type: "text", text }], error: true }];
          }
          return updateTerraParts(msgs, idx, (parts) => [
            ...parts.map((p) => {
              if (p.type === "thinking") return { ...p, done: true };
              if (p.type === "process") return { ...p, steps: completeProcess(p.steps) };
              return p;
            }),
            { type: "text" as const, text },
          ]).map((m, i) => (i === idx ? { ...m, error: true } : m));
        });
      } finally {
        // Aborted by a newer ask (or repo switch) — that owner keeps busy/thinking.
        if (!ac.signal.aborted) {
          busyRef.current = false;
          setThinking(false);
        }
      }
    },
    [repoUrl],
  );

  return { messages, ask, thinking };
}
