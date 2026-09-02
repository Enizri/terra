/** Ask feature — agent job client. */
import { json, jobEvents, post } from "../../shared/http.ts";
import type { AnalyzeEvent, ModelChoice } from "../analysis/index.ts";

/** Opaque selection for the analyzer (see LiveSelection in preview). */
export type Selection = Record<string, unknown>;

export type { ModelChoice };

function askBody(
  repoUrl: string,
  question: string,
  selections: Selection[],
  choice?: ModelChoice,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    repo_url: repoUrl,
    question,
    selection: selections[selections.length - 1] ?? {},
    selections,
  };
  // Ask reuses the model the workspace analyzed with; omitted means the
  // analyzer's own environment decides, exactly as before.
  if (choice?.modelId) body.model_id = choice.modelId;
  if (choice?.apiKey?.trim()) body.api_key = choice.apiKey.trim();
  return body;
}

/** Stream Ask via the agent job. Process steps are driven from these events. */
export async function* askEvents(
  repoUrl: string,
  question: string,
  selections: Selection[],
  signal?: AbortSignal,
  choice?: ModelChoice,
): AsyncGenerator<AnalyzeEvent> {
  const created = await post("/jobs/agent", askBody(repoUrl, question, selections, choice), signal);
  const { job_id } = await json<{ job_id: string }>(created, "ask");
  yield* jobEvents<AnalyzeEvent>(job_id, signal);
}

/** Ask via background job. Last selection is primary; list sent when length > 1. */
export async function ask(
  repoUrl: string,
  question: string,
  selections: Selection[],
  signal?: AbortSignal,
  choice?: ModelChoice,
): Promise<string> {
  for await (const ev of askEvents(repoUrl, question, selections, signal, choice)) {
    if (ev.stage === "done") return ev.answer ?? "No answer.";
  }
  throw new Error("ask ended without an answer");
}
