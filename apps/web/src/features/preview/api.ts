/** Preview feature — live preview proxy + trace stream. */
import { authHeaders, json, jobEvents, noteUnauthorized, post } from "../../shared/http.ts";
import { getToken } from "../../shared/token.ts";
import { tracesURL } from "./tracesUrl.ts";

export { tracesURL };

export type PreviewApp = {
  id: string;
  name: string;
  kind: string;
  framework: string;
  url?: string;
  status: string;
  reason?: string;
};

export type PreviewResult = {
  url: string;
  primary_id: string;
  apps: PreviewApp[];
};

export type PreviewEvent = {
  stage: string;
  label?: string;
  preview?: PreviewResult;
  answer?: string;
};

/** Boot or reuse the repo's preview proxy (legacy one-shot). */
export async function preview(repoUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await post("/preview", { repo_url: repoUrl }, signal);
  const data = await json<PreviewResult>(res, "preview");
  if (!data.url) throw new Error("preview failed");
  return data.url;
}

/** Stream preview boot: checkout → detect → install → boot → ready. */
export async function* previewEvents(
  repoUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<PreviewEvent> {
  const created = await post("/jobs/preview", { repo_url: repoUrl }, signal);
  const { job_id } = await json<{ job_id: string }>(created, "preview");
  yield* jobEvents<PreviewEvent>(job_id, signal);
}

const README_CANDIDATES = ["README.md", "readme.md", "README"];

/** Read a file from the mounted preview checkout. Null while it is still starting. */
export async function repoFile(
  repoUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const q = new URLSearchParams({ repo_url: repoUrl, path });
  const res = await fetch(`/files?${q}`, { headers: authHeaders(), signal });
  noteUnauthorized(res);
  const data = (await res.json().catch(() => null)) as {
    content?: string;
    starting?: boolean;
    error?: string;
  } | null;
  if (data?.starting) return null;
  if (!res.ok) return null;
  return data?.content ?? null;
}

/** First README that exists in the checkout, or null. */
export async function repoReadme(repoUrl: string, signal?: AbortSignal): Promise<string | null> {
  for (const name of README_CANDIDATES) {
    const text = await repoFile(repoUrl, name, signal);
    if (text != null) return text;
  }
  return null;
}

/** Stream `npm test` / `go test` from the mounted checkout. */
export async function* previewTestEvents(
  repoUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<PreviewEvent> {
  const created = await post("/jobs/preview/test", { repo_url: repoUrl }, signal);
  const { job_id } = await json<{ job_id: string }>(created, "tests");
  yield* jobEvents<PreviewEvent>(job_id, signal);
}

/** Preview proxy span — see backend/api/internal/trace. */
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
  // a 401 stops the retries.
  let probed = false;
  es.onerror = () => {
    if (probed) return;
    probed = true;
    fetch(tracesURL(repoUrl, getToken()), { headers: authHeaders() })
      .then((res) => {
        res.body?.cancel();
        if (res.status === 401) {
          noteUnauthorized(res);
          es.close();
        }
      })
      .catch(() => {});
  };
  return () => es.close();
}
