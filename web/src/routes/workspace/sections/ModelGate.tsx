import { useEffect, useState } from "react";
import { hostCapabilities, models as fetchModels } from "../../../shared/api";
import { getApiKey, setApiKey } from "../../../shared/modelKeys";
import {
  eligibility,
  fitNote,
  needsKey,
  type CatalogEntry,
  type HostCapabilities,
  type Recommendation,
} from "../../../shared/models";
import { ApiKeyModal } from "./ApiKeyModal";

/** Hard gate between probe and analyze: nothing costs a token until the user
 * picks a model and hits Continue. */
export function ModelGate({
  recommendation,
  onContinue,
  onCancel,
}: {
  recommendation: Recommendation;
  onContinue: (modelId: string, apiKey?: string, provider?: string) => void;
  onCancel: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [caps, setCaps] = useState<HostCapabilities | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  /** The entry waiting on a key modal. */
  const [pendingKey, setPendingKey] = useState<CatalogEntry | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchModels(ac.signal), hostCapabilities(ac.signal)])
      .then(([list, host]) => {
        setCatalog(list);
        setCaps(host);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setLoadError(e.message);
      });
    return () => ac.abort();
  }, []);

  const pick = (entry: CatalogEntry) => {
    const stored = getApiKey(entry.provider ?? "");
    if (needsKey(entry, stored)) {
      setPendingKey(entry);
      return;
    }
    onContinue(entry.id, stored || undefined, entry.provider);
  };

  const recommended = catalog.find((e) => e.id === recommendation.model_id) ?? null;

  if (pendingKey) {
    return (
      <ApiKeyModal
        provider={pendingKey.provider ?? "provider"}
        modelName={pendingKey.display_name}
        onSubmit={(key) => {
          setApiKey(pendingKey.provider ?? "", key);
          const entry = pendingKey;
          setPendingKey(null);
          onContinue(entry.id, key, entry.provider);
        }}
        onCancel={() => setPendingKey(null)}
      />
    );
  }

  return (
    <div className="sh-ws__running sh-gate">
      <h2 className="sh-gate__title">Choose the model for this analysis</h2>

      {loadError && <p className="sh-ws__error">{loadError}</p>}

      {recommended ? (
        <div className="sh-gate__card">
          <p className="sh-gate__name">
            {recommended.display_name}
            <span className="sh-gate__tag">{recommended.tier}</span>
          </p>
          <p className="sh-gate__why">{recommendation.reason}</p>
          <p className="sh-gate__fit">{fitNote(recommended, caps)}</p>
          <button className="sh-btn" type="button" onClick={() => pick(recommended)}>
            Continue with {recommended.display_name}
          </button>
        </div>
      ) : (
        !loadError && <p className="sh-gate__why">Loading the model catalog…</p>
      )}

      <button className="sh-ws__stop" type="button" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "Hide other models" : "Change model"}
      </button>

      {expanded && (
        <ul className="sh-gate__list">
          {catalog.map((entry) => {
            const { eligible, hint } = eligibility(entry, caps);
            return (
              <li key={entry.id} className="sh-gate__item">
                <button
                  type="button"
                  className="sh-gate__choice"
                  disabled={!eligible}
                  onClick={() => pick(entry)}
                >
                  <span className="sh-gate__name">
                    {entry.display_name}
                    <span className="sh-gate__tag">{entry.tier}</span>
                  </span>
                  <span className="sh-gate__why">{entry.blurb}</span>
                  <span className="sh-gate__fit">{eligible ? fitNote(entry, caps) : hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button className="sh-ws__stop" type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
