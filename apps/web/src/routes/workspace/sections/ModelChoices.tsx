import {
  eligibility,
  fitNote,
  getApiKey,
  needsKey,
  type CatalogEntry,
  type HostCapabilities,
} from "../../../features/analysis";
import { LockIcon } from "../../../shared/shell/icons";

/** Catalog rows: host-ineligible models are disabled; BYOK models with no
 * stored key are closed but still clickable so the caller can save a key. */
export function ModelChoices({
  catalog,
  caps,
  selectedId,
  onPick,
}: {
  catalog: CatalogEntry[];
  caps: HostCapabilities | null;
  selectedId?: string;
  onPick: (entry: CatalogEntry) => void;
}) {
  return (
    <ul className="sh-gate__list">
      {catalog.map((entry) => {
        const { eligible, hint } = eligibility(entry, caps);
        const locked = eligible && needsKey(entry, getApiKey(entry.provider ?? ""));
        return (
          <li key={entry.id} className="sh-gate__item">
            <button
              type="button"
              className={`sh-gate__choice${locked ? " is-locked" : ""}${
                selectedId === entry.id ? " is-selected" : ""
              }`}
              disabled={!eligible}
              onClick={() => onPick(entry)}
            >
              <span className="sh-gate__name">
                {locked && <LockIcon />}
                {entry.display_name}
                <span className="sh-gate__tag">{entry.tier}</span>
              </span>
              <span className="sh-gate__why">{entry.blurb}</span>
              <span className="sh-gate__fit">
                {locked
                  ? "Closed — save an API key locally to use this model"
                  : eligible
                    ? fitNote(entry, caps)
                    : hint}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
