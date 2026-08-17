/** Preview feature — live preview proxy + trace stream. */
import { authHeaders, json, noteUnauthorized, post } from "../../shared/http.ts";
import { getToken } from "../../shared/token.ts";
import { tracesURL } from "./tracesUrl.ts";

export { tracesURL };

/** Boot or reuse the repo's preview proxy. */
export async function preview(repoUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await post("/preview", { repo_url: repoUrl }, signal);
  const data = await json<{ url?: string }>(res, "preview");
  if (!data.url) throw new Error("preview failed");
  return data.url;
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
  // a 401 opens the unlock panel and stops the retries.
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
