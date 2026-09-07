import { useEffect, useMemo, useRef, useState } from "react";
import type { TerraMap } from "../../../features/architecture-map";
import {
  DetailsPanel,
  RepoDiagram,
  drawnAncestor,
  matchComponents,
  matchSpan,
  toDiagram,
  topLevelId,
} from "../../../features/architecture-map";
import { traces, LiveFrame, type LiveSelection } from "../../../features/preview";
import { SearchIcon } from "../../../shared/shell/icons";
import { emptyQueue, enqueue } from "../pulseQueue";

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
      <span className="sh-ws__find-glyph" aria-hidden>
        <SearchIcon />
      </span>
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

/** Map stage with search, details, and live preview pulses. */
export function MapStage({
  map,
  selectedIds,
  onSelect,
  onAsk,
  onElements,
}: {
  map: TerraMap;
  selectedIds: string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  /** Put a component in the ask composer, optionally with a question to send. */
  onAsk: (id: string, question?: string) => void;
  onElements: (picked: LiveSelection[]) => void;
}) {
  const [all, setAll] = useState(false);
  const [preview, setPreview] = useState<"off" | "on">("off");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Stable view — diagram measure effect depends on it.
  const view = useMemo(() => toDiagram(map, { all }), [map, all]);
  const primary = selectedIds[selectedIds.length - 1] ?? null;
  // The panel can be reading a component the canvas never drew — a nested part,
  // or one a node cap left off — reached from the rail, from search, or from a
  // connection link. Light its nearest drawn ancestor so the canvas and the
  // panel are never talking about different places.
  const lit = useMemo(
    () => drawnAncestor(map.components, new Set(view.nodes.map((n) => n.id)), primary),
    [map.components, view.nodes, primary],
  );

  const [pulseId, setPulseId] = useState<string | null>(null);
  useEffect(() => {
    if (preview === "off") return;
    let queue = emptyQueue;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = traces(map.project.repository_url, (span) => {
      const hit = matchSpan(span.path, map.components);
      const id = hit ? topLevelId(hit) : null;
      const next = enqueue(queue, id, Date.now());
      queue = next.state;
      if (next.showAt == null || id == null) return;
      const t = setTimeout(() => {
        timers.delete(t);
        setPulseId(id);
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => setPulseId(null), 950);
      }, Math.max(0, next.showAt - Date.now()));
      timers.add(t);
    });
    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
      if (clearTimer) clearTimeout(clearTimer);
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
      {/* One row that cannot wrap: every row this strip grows by is a row the
          map loses, and the stage clips rather than scrolls. Identity on the
          left, counts in the middle, controls on the right. */}
      <div className="sh-ws__toolbar">
        <div className="sh-ws__toolbar-id">
          <b>{map.project.name}</b>
          <em>{map.project.description}</em>
        </div>
        <div className="sh-ws__toolbar-stats">
          <span className="sh-chip">{map.components.length} components</span>
          <span className="sh-chip">{map.relationships.length} relationships</span>
          <span className="sh-chip">{map.project.primary_languages.join(" · ")}</span>
        </div>
        <div className="sh-ws__toolbar-actions">
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
      </div>
      <div className={`sh-ws__map${primary ? " has-details" : ""}`}>
        <RepoDiagram
          dense
          nodes={view.nodes}
          edges={view.edges}
          groups={view.groups}
          selectedId={lit}
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
            <LiveFrame frameRef={frameRef} repoUrl={map.project.repository_url} />
          </div>
        )}
        {/* Always mounted, never resized — see `.sh-ws__map` in stage.css. With
            nothing selected it is the map's table of contents, which is why the
            column can afford to be permanent. */}
        <aside className="sh-ws__details" aria-label="Details for the selected part">
          <DetailsPanel
            map={map}
            selectedIds={selectedIds}
            onSelect={(id) => select(id)}
            onAsk={onAsk}
          />
        </aside>
      </div>
    </>
  );
}
