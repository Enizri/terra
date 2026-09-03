/** Probe an API preview: seed routes, then one extra GET/POST on the same origin. */
import { useEffect, useState, type FormEvent } from "react";
import { previewProbe, previewRoutes, type ProbeHit } from "./api.ts";

export function ApiConsole({
  repoUrl,
  origin,
}: {
  repoUrl: string;
  origin: string;
}) {
  const [hits, setHits] = useState<ProbeHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("/");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const routes = await previewRoutes(repoUrl, ac.signal);
        const next: ProbeHit[] = [];
        for (const p of routes) {
          if (ac.signal.aborted) return;
          next.push(await previewProbe(repoUrl, origin, "GET", p, ac.signal));
        }
        if (!ac.signal.aborted) setHits(next);
      } catch (e) {
        const err = e as Error;
        if (err.name !== "AbortError") setError(err.message);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [repoUrl, origin]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    void previewProbe(repoUrl, origin, method, path)
      .then((hit) => setHits((prev) => [hit, ...prev.filter((h) => h.path !== hit.path || h.method !== hit.method)]))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="sh-live-pack">
      <p className="sh-live-pack__why">
        API at <code>{origin}</code> — Terra probes it instead of iframing a blank tab.
      </p>
      <form className="sh-live-cli" onSubmit={onSubmit}>
        <select
          className="sh-live-cli__in"
          style={{ flex: "0 0 5.5rem" }}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          aria-label="HTTP method"
        >
          <option>GET</option>
          <option>POST</option>
        </select>
        <input
          className="sh-live-cli__in"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/healthz"
          spellCheck={false}
          aria-label="API path"
        />
        <button type="submit" className="sh-chip sh-chip--btn" disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
      {error ? <p className="sh-live__status sh-live__status--error">{error}</p> : null}
      {loading && hits.length === 0 ? <p className="sh-live__status">Probing the API…</p> : null}
      <ul className="sh-live-api">
        {hits.map((hit) => (
          <li key={`${hit.method}:${hit.path}`} className="sh-live-api__hit">
            <header>
              <b>
                {hit.method} {hit.path}
              </b>
              <em>{hit.status}</em>
            </header>
            <pre>{hit.body || "(empty)"}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}
