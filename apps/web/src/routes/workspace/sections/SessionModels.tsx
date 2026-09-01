import { useEffect, useRef, useState } from "react";
import {
  hostCapabilities,
  models as fetchModels,
  getApiKey,
  setApiKey,
  needsKey,
  type CatalogEntry,
  type HostCapabilities,
  type ModelChoice,
} from "../../../features/analysis";
import { ChevronIcon } from "../../../shared/shell/icons";
import { ApiKeyModal } from "./ApiKeyModal";
import { ModelChoices } from "./ModelChoices";

/** Codex/Claude-style model chip next to the chat prompt. Closed until toggled. */
export function SessionModels({
  selected,
  onChoose,
}: {
  selected?: ModelChoice | null;
  onChoose: (choice: ModelChoice) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [caps, setCaps] = useState<HostCapabilities | null>(null);
  const [open, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<CatalogEntry | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([fetchModels(ac.signal), hostCapabilities(ac.signal)])
      .then(([list, host]) => {
        setCatalog(list);
        setCaps(host);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") console.error(e);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const pick = (entry: CatalogEntry) => {
    const stored = getApiKey(entry.provider ?? "");
    if (needsKey(entry, stored)) {
      setPendingKey(entry);
      return;
    }
    onChoose({ modelId: entry.id, apiKey: stored || undefined });
    setOpen(false);
  };

  const current = catalog.find((e) => e.id === selected?.modelId) ?? null;
  const label = current?.display_name ?? "Choose model";

  return (
    <div className="sh-model-toggle" ref={rootRef}>
      <button
        type="button"
        className={`sh-model-toggle__btn${open ? " is-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sh-model-toggle__label">{label}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="sh-model-toggle__menu" role="listbox" aria-label="Working models">
          <ModelChoices catalog={catalog} caps={caps} selectedId={selected?.modelId} onPick={pick} />
        </div>
      )}
      {pendingKey && (
        <ApiKeyModal
          provider={pendingKey.provider ?? "provider"}
          modelName={pendingKey.display_name}
          submitLabel="Save API key locally"
          onSubmit={(key) => {
            setApiKey(pendingKey.provider ?? "", key);
            const entry = pendingKey;
            setPendingKey(null);
            onChoose({ modelId: entry.id, apiKey: key });
            setOpen(false);
          }}
          onCancel={() => setPendingKey(null)}
        />
      )}
    </div>
  );
}
