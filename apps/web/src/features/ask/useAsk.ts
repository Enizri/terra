import { useCallback, useEffect, useRef, useState } from "react";
import { askEvents, type ModelChoice, type Selection } from "./api";
import {
  buildProcess,
  completeProcess,
  applyJobEvent,
  updateTerraParts,
  hasMeaningfulSelection,
  type AskMessage,
  type AskPart,
} from "./askProcess";

export type { AskMessage, AskPart, ProcessStep, ProcessStepStatus } from "./askProcess";

const THINKING_COPY = "Considering the map and what you selected…";

/** Ask job for one repo; process steps follow job events; abort cancels. */
export function useAsk(repoUrl: string | null, model?: ModelChoice) {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Ref avoids stale `thinking` in a stable callback (double-send).
  const busyRef = useRef(false);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  // New repo → new conversation; drop in-flight answers from the previous.
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setThinking(false);
    busyRef.current = false;
  }, [repoUrl]);

  const ask = useCallback(
    async (question: string, selection?: Selection, selections?: Selection[]) => {
      const q = question.trim();
      if (!q || !repoUrl || busyRef.current) return;

      abortRef.current?.abort();
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

      const applyEvent = (ev: { stage: string; label?: string }) => {
        setMessages((msgs) => {
          const idx = msgs.length - 1;
          if (idx < 0 || msgs[idx].role !== "terra") return msgs;
          return updateTerraParts(msgs, idx, (parts) =>
            parts.map((p) =>
              p.type === "process" ? { ...p, steps: applyJobEvent(p.steps, ev) } : p,
            ),
          );
        });
      };

      try {
        let answer = "No answer.";
        for await (const ev of askEvents(
          repoUrl,
          q,
          selections ?? (selection ? [selection] : []),
          ac.signal,
          model,
        )) {
          if (ev.stage === "done") {
            answer = ev.answer ?? "No answer.";
            break;
          }
          applyEvent(ev);
        }
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
    [repoUrl, model],
  );

  return { messages, ask, thinking };
}
