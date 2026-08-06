/**
 * The only place that talks to the Go server (`terra serve`). Same-origin in
 * production, proxied by Vite in dev — so no base URL and no CORS anywhere.
 *
 * Every call takes an AbortSignal and reports failures the same way: the
 * server answers errors as {"error": "..."} (internal/server.httpError), so
 * that message is what gets thrown.
 */
import type { TerraMap } from "./map/types";
import { ndjsonSplitter } from "./ndjson";

/**
 * A selection is forwarded to the analyzer untouched (the Go side types it as
 * map[string]any), so this client stays out of its shape. See LiveSelection in
 * shared/live.tsx for what select.js actually posts.
 */
export type Selection = Record<string, unknown>;

export type AnalyzeEvent = {
  stage: "clone" | "scan" | "analyze" | "store" | "done" | "error";
  label?: string;
  map?: TerraMap;
};

export type FilesResponse = {
  path?: string;
  /** Directory listing… */
  entries?: { name: string; path: string; dir: boolean }[];
  /** …or a single file's text. */
  content?: string;
  /** Set while the checkout is still booting. */
  starting?: boolean;
};

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Read a JSON response, turning both transport and server errors into throws. */
async function json<T>(res: Response, what: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok || (data as { error?: string } | null)?.error) {
    throw new Error((data as { error?: string } | null)?.error ?? `${what} failed (${res.status})`);
  }
  return data as T;
}

/**
 * POST /analyze in NDJSON mode, yielding one stage event at a time so the
 * caller can render progress while the clone/scan/analyze pipeline runs.
 */
export async function* analyze(repoUrl: string, signal?: AbortSignal): AsyncGenerator<AnalyzeEvent> {
  const res = await fetch("/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ repo_url: repoUrl }),
    signal,
  });

  // A rejected URL never reaches the stream — it comes back as {"error"}.
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `analyze failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = ndjsonSplitter<AnalyzeEvent>();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const ev of feed(decoder.decode(value, { stream: true }))) {
      if (ev.stage === "error") throw new Error(ev.label ?? "analysis failed");
      yield ev;
    }
  }
}

/**
 * Ask about a selection. `selections` is always sent; the server keeps the
 * last one as the primary and only forwards the list when it holds more than
 * one entry (internal/server.ask), so callers do not special-case the single
 * selection.
 */
export async function ask(
  repoUrl: string,
  question: string,
  selections: Selection[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await post(
    "/ask",
    {
      repo_url: repoUrl,
      question,
      selection: selections[selections.length - 1] ?? {},
      selections,
    },
    signal,
  );
  const data = await json<{ answer?: string }>(res, "ask");
  return data.answer ?? "No answer.";
}

/** Boot (or reuse) the repo's dev server behind the Go preview proxy. */
export async function preview(repoUrl: string, signal?: AbortSignal): Promise<string> {
  const res = await post("/preview", { repo_url: repoUrl }, signal);
  const data = await json<{ url?: string }>(res, "preview");
  if (!data.url) throw new Error("preview failed");
  return data.url;
}

/** One request the live preview's proxy observed — see internal/trace. */
export type TraceSpan = {
  repo: string;
  time: string;
  method: string;
  path: string;
  status: number;
  dur_ms: number;
  /** Where it was observed: "edge" (proxy), "server" or "client" (Node hook). */
  kind?: string;
};

/**
 * Subscribe to the preview's request spans (GET /traces, Server-Sent
 * Events). Ring-buffer history replays first, then live spans. Returns an
 * unsubscribe function; transport errors just end the stream — the map
 * simply stops pulsing.
 */
export function traces(repoUrl: string, onSpan: (span: TraceSpan) => void): () => void {
  const es = new EventSource(`/traces?repo_url=${encodeURIComponent(repoUrl)}`);
  es.onmessage = (e) => {
    try {
      onSpan(JSON.parse(e.data) as TraceSpan);
    } catch {
      // A malformed event is dropped, not fatal.
    }
  };
  return () => es.close();
}

/** One stored analysis, as GET /analyses lists them (internal/store.Summary). */
export type AnalysisSummary = {
  id: number;
  repo_url: string;
  name: string;
  scanned_at: string;
};

/** List every stored analysis, newest first. */
export async function analyses(signal?: AbortSignal): Promise<AnalysisSummary[]> {
  const res = await fetch("/analyses", { signal });
  return json<AnalysisSummary[]>(res, "analyses");
}

/** Fetch one stored analysis's map without re-running the pipeline. */
export async function analysis(id: number, signal?: AbortSignal): Promise<TerraMap> {
  const res = await fetch(`/analyses/${id}`, { signal });
  return json<TerraMap>(res, "analysis");
}

/** List a directory, or read a file, inside the preview's checkout. */
export async function files(repoUrl: string, path: string, signal?: AbortSignal): Promise<FilesResponse> {
  const query = `repo_url=${encodeURIComponent(repoUrl)}&path=${encodeURIComponent(path)}`;
  const res = await fetch(`/files?${query}`, { signal });
  return json<FilesResponse>(res, "files");
}
