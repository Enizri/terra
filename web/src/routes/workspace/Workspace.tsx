import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { Component, TerraMap } from "../../shared/map/types";
import type { LiveSelection } from "../../shared/live";
import memosFixture from "../../data/memos.map.json";
import { analyses, analysis } from "../../shared/api";
import { useAnalyze } from "./useAnalyze";
import { nextSelection } from "./selection";
import { toHistory, type HistoryEntry } from "./history";
import { WorkspaceHeader } from "./sections/WorkspaceHeader";
import { Sidebar } from "./sections/Sidebar";
import { DropStage } from "./sections/Stage";
import { AgentDock } from "./sections/AgentDock";
// Owns its skin import: today terra.css only loads because App statically
// imports TerraLanding, which stops being true the moment a route is lazy.
import "../../shared/styles/tokens.css";
import "../../shared/styles/ui.css";
import "./workspace.css";

/**
 * The product surface. It owns exactly what two panes have to agree on — the
 * analysis run, what is selected, and what this tab has mapped — and nothing
 * about how any pane draws itself.
 */
export default function Workspace() {
  const { slug = "untitled" } = useParams();
  const { search } = useLocation();
  // Lifted so the header star can spin while the stage runs.
  const analyze = useAnalyze();
  /** Up to three cards, oldest first — the theater's cap, for the same reason. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [elements, setElements] = useState<LiveSelection[]>([]);
  /** The store's analyses, newest first — history is the SQLite store now. */
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /** A stored map opened from the rail — shown without re-running the pipeline. */
  const [storedMap, setStoredMap] = useState<TerraMap | null>(null);

  // ponytail: dev-only render harness — `?fixture` draws the golden memos map
  // with no Go server. Upgrade path: a real fixture picker if a second map lands.
  const fixture =
    import.meta.env.DEV && new URLSearchParams(search).has("fixture")
      ? (memosFixture as TerraMap)
      : null;
  // A live run always wins; a stored map opened from the rail beats the last
  // finished run (a fresh run clears it again below).
  const map = analyze.running ? analyze.map : (storedMap ?? analyze.map ?? fixture);

  useEffect(() => {
    setSelectedIds([]);
    setElements([]);
  }, [map]);

  // History is the store's list: fetched on mount, re-fetched after a run
  // lands (the run just wrote a row). Server down or empty DB → empty rail.
  useEffect(() => {
    if (analyze.map) setStoredMap(null); // the fresh run is what's on stage now
    const ac = new AbortController();
    analyses(ac.signal)
      .then((rows) => setHistory(toHistory(rows)))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setHistory([]);
      });
    return () => ac.abort();
  }, [analyze.map]);

  // Open a stored analysis's saved map — no pipeline re-run. A failure just
  // leaves the stage as it was; the row itself is the error surface.
  const open = async (entry: HistoryEntry) => {
    try {
      setStoredMap(await analysis(entry.id));
    } catch {
      // ponytail: swallowed — no toast layer exists yet. Upgrade path: surface
      // it in the rail row once the app grows an error affordance.
    }
  };

  const select = (id: string | null, additive?: boolean) => {
    if (!id) return setSelectedIds([]);
    setSelectedIds((prev) => nextSelection(prev, id, additive));
  };

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => map?.components.find((c) => c.id === id))
        .filter((c): c is Component => !!c),
    [selectedIds, map],
  );

  return (
    <div className="sh-root sh-ws">
      <WorkspaceHeader slug={slug} busy={analyze.running} />
      <Sidebar
        map={map}
        history={history}
        onSelect={select}
        onOpen={open}
        busy={analyze.running}
      />
      <DropStage
        analyze={analyze}
        map={map}
        selectedIds={selectedIds}
        onSelect={select}
        onElements={setElements}
      />
      <AgentDock
        map={map}
        selected={selected}
        elements={elements}
        onDropComponent={(id) => setSelectedIds((prev) => prev.filter((x) => x !== id))}
        onDropElement={(el) => setElements((prev) => prev.filter((x) => x !== el))}
      />
    </div>
  );
}
