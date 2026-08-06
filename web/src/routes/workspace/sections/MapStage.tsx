import { useEffect, useMemo, useRef, useState } from "react";
import type { TerraMap } from "../../../shared/map/types";
import RepoDiagram from "../../../shared/map/RepoDiagram";
import DetailsPanel from "../../../shared/map/DetailsPanel";
import { toDiagram } from "../../../shared/map/toDiagram";
import { matchComponents } from "../../../shared/map/search";
import { matchSpan, topLevelId } from "../../../shared/map/spanMatch";
import { traces } from "../../../shared/api";
import { LiveFrame, type LiveSelection } from "../../../shared/live";

/**
 * Find a component by name, tech, type, file or purpose and jump to it.
 * Selecting is the whole feature — the map already dims everything else.
 */
function MapSearch({ map, onSelect }: { map: TerraMap; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const results = matchComponents(map.components, query);

  const pick = (id: string) => {
    onSelect(id);
    setQuery("");
  };

  return (
    <form
      className="sh-ws__find"
      onSubmit={(e) => {
        e.preventDefault();
        if (results.length > 0) pick(results[0].id);
      }}
    >
      <input
        className="sh-ws__find-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        placeholder="Find a component"
        aria-label="Find a component in the map"
        spellCheck={false}
      />
      {query.trim() && (
        <ul className="sh-ws__find-list">
          {results.length === 0 && <li className="sh-ws__find-empty">No component matches.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="sh-ws__find-hit" onClick={() => pick(c.id)}>
                <b>{c.name}</b>
                <em>{c.type}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

/** Everything the old ResultCard said, compressed into one strip above the map. */
export function MapStage({
  map,
  selectedIds,
  onSelect,
  onElements,
}: {
  map: TerraMap;
  selectedIds: string[];
  /** `additive` (shift/⌘-click) stacks a second card onto the selection. */
  onSelect: (id: string | null, additive?: boolean) => void;
  onElements: (picked: LiveSelection[]) => void;
}) {
  /** Caps lifted — every component gets a card, however small. */
  const [all, setAll] = useState(false);
  const [preview, setPreview] = useState<"off" | "on">("off");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Memoised: the view is a dependency of the diagram's measure effect, and a
  // fresh object every render would rebuild its observers on every keystroke.
  const view = useMemo(() => toDiagram(map, { all }), [map, all]);
  const primary = selectedIds[selectedIds.length - 1] ?? null;

  // Live trace: while the preview is open, every request its proxy observes
  // pulses the component that handled it. History replays on connect, so the
  // last-used card glows the moment the stream opens.
  const [pulseId, setPulseId] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (preview === "off") return;
    const unsubscribe = traces(map.project.repository_url, (span) => {
      const hit = matchSpan(span.path, map.components);
      if (!hit) return;
      setPulseId(topLevelId(hit));
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulseId(null), 950);
    });
    return () => {
      unsubscribe();
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      setPulseId(null);
    };
  }, [preview, map]);

  // Element picks come from select.js, injected into the preview by the Go proxy.
  useEffect(() => {
    if (preview === "off") return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; items?: LiveSelection[] };
      if (d?.type !== "terra:selection") return;
      onElements(Array.isArray(d.items) ? d.items : []);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [preview, onElements]);

  const select = (id: string | null, additive?: boolean) => {
    // Searching for a card the caps hid would otherwise select nothing visible.
    if (id && view.hidden.some((c) => c.id === id)) setAll(true);
    onSelect(id, additive);
  };

  return (
    <>
      <div className="sh-ws__mapbar">
        <b>{map.project.name}</b>
        <em>{map.project.description}</em>
        <span className="sh-chip">{map.components.length} components</span>
        <span className="sh-chip">{map.relationships.length} relationships</span>
        <span className="sh-chip">{map.project.primary_languages.join(" · ")}</span>
        {view.hidden.length > 0 && !all && (
          <button type="button" className="sh-chip sh-chip--btn" onClick={() => setAll(true)}>
            +{view.hidden.length} more
          </button>
        )}
        {all && (
          <button type="button" className="sh-chip sh-chip--btn" onClick={() => setAll(false)}>
            Show the main parts
          </button>
        )}
        <button
          type="button"
          className={`sh-chip sh-chip--btn${preview === "on" ? " is-on" : ""}`}
          onClick={() => setPreview((p) => (p === "on" ? "off" : "on"))}
        >
          {preview === "on" ? "Close preview" : "Live preview"}
        </button>
        <MapSearch map={map} onSelect={select} />
      </div>
      <div className={`sh-ws__map${primary ? " has-details" : ""}`}>
        <RepoDiagram
          nodes={view.nodes}
          edges={view.edges}
          groups={view.groups}
          selectedId={primary}
          pulseId={pulseId}
          onSelect={select}
          labelsOnHover
          remeasureKey={preview}
          legendNote="Hover a card to trace its wiring — click to open it, shift-click to stack up to three"
          header={
            <header className="sh-diagram__header">
              <div className="sh-diagram__title">
                <div className="sh-diagram__repo">{map.project.repository_url}</div>
                <div className="sh-diagram__meta">
                  {view.nodes.length} parts · read straight from the code
                </div>
              </div>
            </header>
          }
        />
        {preview === "on" && (
          <div className="sh-ws__preview">
            {/* Boots a real dev server for the mapped repo — only some projects
                have one, so this stays behind the button and says so on failure. */}
            <LiveFrame picking frameRef={frameRef} repoUrl={map.project.repository_url} />
          </div>
        )}
        {primary && (
          <div className="sh-ws__details">
            <DetailsPanel map={map} selectedId={primary} onSelect={onSelect} />
          </div>
        )}
      </div>
    </>
  );
}
