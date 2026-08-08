/** Go server client (`terra serve`). Same-origin / Vite proxy; errors as {"error":"..."}. */
import type { TerraMap } from "./map/types";
import { ndjsonSplitter } from "./ndjson";
import { getToken, notifyUnauthorized } from "./token";
import { tracesURL } from "./tracesUrl";

export { tracesURL };

/** Opaque selection for the analyzer (see LiveSelection in live.tsx). */
export type Selection = Record<string, unknown>;

export type AnalyzeEvent = {
  stage: "clone" | "scan" | "analyze" | "store" | "ask" | "done" | "error";
  label?: string;
  map?: TerraMap;
  answer?: string;
};

function authHeaders(extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function noteUnauthorized(res: Response): void {
  if (res.status === 401) notifyUnauthorized();
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });
}

/** JSON response; transport and server errors throw. */
async function json<T>(res: Response, what: string): Promise<T> {
  noteUnauthorized(res);
  const data = await res.json().catch(() => null);
  if (!res.ok || (data as { error?: string } | null)?.error) {
    throw new Error((data as { error?: string } | null)?.error ?? `${what} failed (${res.status})`);
  }
  return data as T;
}

/** Best-effort job cancel — never throws. */
export function cancelJob(jobId: string): void {
  void fetch(`/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  }).catch(() => {});
}

async function* jobEvents(jobId: string, signal?: AbortSignal): AsyncGenerator<AnalyzeEvent> {
  // Abort raced the enqueue POST: the listener below would never fire on an
  // already-aborted signal, leaving the server job running.
  if (signal?.aborted) {
    cancelJob(jobId);
    const err = new Error("cancelled");
    err.name = "AbortError";
    throw err;
  }
  const onAbort = () => cancelJob(jobId);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(`/jobs/${jobId}/events`, {
      headers: authHeaders({ Accept: "application/x-ndjson" }),
      signal,
    });
    if (!res.ok || !res.body) {
      noteUnauthorized(res);
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error ?? `job events failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const feed = ndjsonSplitter<AnalyzeEvent>();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      for (const ev of feed(decoder.decode(value, { stream: true }))) {
        if (ev.stage === "error") {
          // Cancel-on-abort must look like a fetch abort so UI hooks stay quiet.
          if (ev.label === "cancelled" || signal?.aborted) {
            const err = new Error("cancelled");
            err.name = "AbortError";
            throw err;
          }
          throw new Error(ev.label ?? "job failed");
        }
        yield ev;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Enqueue analyze; stream stage events. Abort also cancels the job. */
export async function* analyze(repoUrl: string, signal?: AbortSignal): AsyncGenerator<AnalyzeEvent> {
  const created = await post("/jobs/analyze", { repo_url: repoUrl }, signal);
  const { job_id } = await json<{ job_id: string }>(created, "analyze");
  yield* jobEvents(job_id, signal);
}

/** Ask via background job. Last selection is primary; list sent when length > 1. */
export async function ask(
  repoUrl: string,
  question: string,
  selections: Selection[],
  signal?: AbortSignal,
): Promise<string> {
  const created = await post(
    "/jobs/ask",
    {
      repo_url: repoUrl,
      question,
      selection: selections[selections.length - 1] ?? {},
      selections,
    },
    signal,
  );
  const { job_id } = await json<{ job_id: string }>(created, "ask");
  for await (const ev of jobEvents(job_id, signal)) {
    if (ev.stage === "done") return ev.answer ?? "No answer.";
  }
  throw new Error("ask ended without an answer");
}

/** Boot or reuse the repo's preview proxy. */
export async function preview(repoUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await post("/preview", { repo_url: repoUrl }, signal);
  const data = await json<{ url?: string }>(res, "preview");
  if (!data.url) throw new Error("preview failed");
  return data.url;
}

/** Preview proxy span — see internal/trace. */
export type TraceSpan = {
  repo: string;
  time: string;
  method: string;
  path: string;
  status: number;
  dur_ms: number;
  /** "edge" | "server" | "client" */
  kind?: string;
};

/** Subscribe to preview request spans (SSE). Returns unsubscribe. */
export function traces(repoUrl: string, onSpan: (span: TraceSpan) => void): () => void {
  const es = new EventSource(tracesURL(repoUrl, getToken()));
  es.onmessage = (e) => {
    try {
      onSpan(JSON.parse(e.data) as TraceSpan);
    } catch {
      // drop malformed events
    }
  };
  // EventSource hides status codes: without this, a bad token is a silently
  // dead pulse stream retry-looping in the background. Probe once on error so
  // a 401 opens the unlock panel and stops the retries.
  let probed = false;
  es.onerror = () => {
    if (probed) return;
    probed = true;
    fetch(tracesURL(repoUrl, getToken()), { headers: authHeaders() })
      .then((res) => {
        res.body?.cancel();
        if (res.status === 401) {
          notifyUnauthorized();
          es.close();
        }
      })
      .catch(() => {});
  };
  return () => es.close();
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
