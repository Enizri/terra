/** Shared HTTP / NDJSON transport for Go server clients (same-origin / Vite proxy). */
import { ndjsonSplitter } from "./ndjson.ts";
import { getToken, notifyUnauthorized } from "./token.ts";

export function authHeaders(extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = { ...extra };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function noteUnauthorized(res: Response): void {
  if (res.status === 401) notifyUnauthorized();
}

export async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });
}

/** JSON response; transport and server errors throw. */
export async function json<T>(res: Response, what: string): Promise<T> {
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

type JobEventBase = { stage: string; label?: string };

/** Stream NDJSON stage events for a background job. Abort also cancels the job. */
export async function* jobEvents<T extends JobEventBase>(
  jobId: string,
  signal?: AbortSignal,
): AsyncGenerator<T> {
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
    const feed = ndjsonSplitter<T>();
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
