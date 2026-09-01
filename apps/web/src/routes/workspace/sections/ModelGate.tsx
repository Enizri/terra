import { useEffect, useState } from "react";
import {
  hostCapabilities,
  models as fetchModels,
  getApiKey,
  setApiKey,
  eligibility,
  fitNote,
  needsKey,
  type CatalogEntry,
  type HostCapabilities,
  type Recommendation,
} from "../../../features/analysis";
import { ApiKeyModal } from "./ApiKeyModal";
import { ModelChoices } from "./ModelChoices";

/** Hard gate between probe and analyze: nothing costs a token until the user
 * picks a model and hits Continue. BYOK models without a stored key stay closed. */
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
  const recommendedLocked =
    !!recommended && needsKey(recommended, getApiKey(recommended.provider ?? ""));
  const recommendedBlocked =
    !!recommended && !eligibility(recommended, caps).eligible;

  if (pendingKey) {
    return (
      <ApiKeyModal
        provider={pendingKey.provider ?? "provider"}
        modelName={pendingKey.display_name}
        submitLabel="Save API key locally"
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
        <div className={`sh-gate__card${recommendedLocked ? " is-locked" : ""}`}>
          <p className="sh-gate__name">
            {recommended.display_name}
            <span className="sh-gate__tag">{recommended.tier}</span>
          </p>
          <p className="sh-gate__why">{recommendation.reason}</p>
          <p className="sh-gate__fit">
            {recommendedLocked
              ? "Closed — save an API key locally to use this model"
              : fitNote(recommended, caps)}
          </p>
          <button
            className="sh-btn"
            type="button"
            disabled={recommendedBlocked}
            onClick={() => pick(recommended)}
          >
            {recommendedLocked
              ? `Save a key for ${recommended.display_name}`
              : `Continue with ${recommended.display_name}`}
          </button>
        </div>
      ) : (
        !loadError && <p className="sh-gate__why">Loading the model catalog…</p>
      )}

      <button className="sh-ws__stop" type="button" onClick={() => setExpanded((v) => !v)}>
        {expanded ? "Hide other models" : "Change model"}
      </button>

      {expanded && <ModelChoices catalog={catalog} caps={caps} onPick={pick} />}

      <button className="sh-ws__stop" type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
