/** Analysis feature — probe, analyze jobs, stored analyses, model catalog. */
import type { TerraMap } from "../architecture-map/index.ts";
import { authHeaders, json, jobEvents, noteUnauthorized, post } from "../../shared/http.ts";
import {
  analyzeBody,
  type AnalyzeOptions,
  type CatalogEntry,
  type HostCapabilities,
  type ProbeRepo,
  type Recommendation,
} from "./models.ts";

export { analyzeBody, type AnalyzeOptions };
export type { CatalogEntry, HostCapabilities, ProbeRepo, Recommendation };

export type AnalyzeEvent = {
  stage:
    | "fetch"
    | "clone"
    | "scan"
    | "recommend"
    | "ensure_model"
    | "analyze"
    | "store"
    | "ask"
    | "done"
    | "error";
  label?: string;
  map?: TerraMap;
  answer?: string;
  /** probe only */
  probe_id?: string;
  repo?: ProbeRepo;
  recommendation?: Recommendation;
};

/** What the picker needs before the gate can render. */
export type ModelChoice = { modelId: string; apiKey?: string };

/** Cheap first half: fetch, scan, recommend a model. No LLM call, no gate
 * decision — the caller shows the recommendation and waits for the user. */
export async function* probe(repoUrl: string, signal?: AbortSignal): AsyncGenerator<AnalyzeEvent> {
  const created = await post("/jobs/probe", { repo_url: repoUrl }, signal);
  const { job_id } = await json<{ job_id: string }>(created, "probe");
  yield* jobEvents<AnalyzeEvent>(job_id, signal);
}

/** Enqueue analyze; stream stage events. Abort also cancels the job. */
export async function* analyze(
  opts: AnalyzeOptions,
  signal?: AbortSignal,
): AsyncGenerator<AnalyzeEvent> {
  const created = await post("/jobs/analyze", analyzeBody(opts), signal);
  const { job_id } = await json<{ job_id: string }>(created, "analyze");
  yield* jobEvents<AnalyzeEvent>(job_id, signal);
}

/** Static model catalog. Open route — no token needed. */
export async function models(signal?: AbortSignal): Promise<CatalogEntry[]> {
  const res = await fetch("/models", { headers: authHeaders(), signal });
  const data = await json<{ models: CatalogEntry[] }>(res, "models");
  return data.models ?? [];
}

/** What this Terra host can run locally. Open route. */
export async function hostCapabilities(signal?: AbortSignal): Promise<HostCapabilities> {
  const res = await fetch("/host/capabilities", { headers: authHeaders(), signal });
  return json<HostCapabilities>(res, "host capabilities");
}

/** Stored analysis summary (GET /analyses). */
export type AnalysisSummary = {
  id: number;
  repo_url: string;
  name: string;
  scanned_at: string;
};

export async function analyses(signal?: AbortSignal): Promise<AnalysisSummary[]> {
  const res = await fetch("/analyses", { headers: authHeaders(), signal });
  return json<AnalysisSummary[]>(res, "analyses");
}

/** Fetch a stored map without re-running the pipeline. */
export async function analysis(id: number, signal?: AbortSignal): Promise<TerraMap> {
  const res = await fetch(`/analyses/${id}`, { headers: authHeaders(), signal });
  return json<TerraMap>(res, "analysis");
}

/** Delete a stored analysis from the database. */
export async function deleteAnalysis(id: number, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`/analyses/${id}`, { method: "DELETE", headers: authHeaders(), signal });
  noteUnauthorized(res);
  if (res.ok) return;
  const data = await res.json().catch(() => null);
  throw new Error((data as { error?: string } | null)?.error ?? `delete failed (${res.status})`);
}
