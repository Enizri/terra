import type { Selection } from "./api.ts";

/** Pure ask message/process transitions (React-free for tests). */

export type ProcessStepStatus = "pending" | "active" | "done" | "skipped";

export type ProcessStep = {
  id: string;
  label: string;
  status: ProcessStepStatus;
};

export type AskPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; done?: boolean }
  | { type: "process"; steps: ProcessStep[] };

export type AskMessage = {
  role: "user" | "terra";
  parts: AskPart[];
  error?: boolean;
};

export function buildProcess(hasSelection: boolean): ProcessStep[] {
  return [
    { id: "map", label: "Reading map", status: "active" },
    {
      id: "files",
      label: "Checking selection / files",
      status: hasSelection ? "pending" : "skipped",
    },
    { id: "answer", label: "Answering", status: "pending" },
  ];
}

export function advanceProcess(steps: ProcessStep[]): ProcessStep[] {
  const active = steps.findIndex((s) => s.status === "active");
  if (active < 0) return steps;
  const next = steps.map((s, i) => (i === active ? { ...s, status: "done" as const } : s));
  const upcoming = next.findIndex((s) => s.status === "pending");
  if (upcoming < 0) return next;
  return next.map((s, i) => (i === upcoming ? { ...s, status: "active" as const } : s));
}

export function completeProcess(steps: ProcessStep[]): ProcessStep[] {
  return steps.map((s) =>
    s.status === "skipped" ? s : { ...s, status: "done" as const },
  );
}

/** Drive process steps from live job events instead of a client-side timer. */
export function applyJobEvent(
  steps: ProcessStep[],
  event: { stage: string; label?: string },
): ProcessStep[] {
  switch (event.stage) {
    case "ensure_model":
    case "ask":
      return steps.map((s) =>
        s.id === "map" && s.status === "pending" ? { ...s, status: "active" as const } : s,
      );
    case "retrieve":
    case "tool":
      return steps.map((s) => {
        if (s.id === "map") return { ...s, status: "done" as const };
        if (s.id === "files") {
          return {
            ...s,
            status: "active" as const,
            label: event.label?.trim() || s.label,
          };
        }
        return s;
      });
    case "done":
      return completeProcess(steps);
    default:
      return steps;
  }
}

export function updateTerraParts(
  messages: AskMessage[],
  terraIndex: number,
  update: (parts: AskPart[]) => AskPart[],
): AskMessage[] {
  return messages.map((m, i) => (i === terraIndex ? { ...m, parts: update(m.parts) } : m));
}

export function hasMeaningfulSelection(
  selection?: Selection,
  selections?: Selection[],
): boolean {
  if (selections && selections.length > 0) {
    return selections.some((s) => Object.keys(s).length > 0);
  }
  return Boolean(selection && Object.keys(selection).length > 0);
}
