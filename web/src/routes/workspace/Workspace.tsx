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
import "../../shared/styles/tokens.css";
import "../../shared/styles/ui.css";
import "./workspace.css";

/** Workspace: analysis run, selection, and the mapped tab. */
export default function Workspace() {
  const { slug = "untitled" } = useParams();
  const { search } = useLocation();
  const analyze = useAnalyze();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [elements, setElements] = useState<LiveSelection[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /** Stored map from the rail — no pipeline re-run. */
  const [storedMap, setStoredMap] = useState<TerraMap | null>(null);

  const fixture =
    import.meta.env.DEV && new URLSearchParams(search).has("fixture")
      ? (memosFixture as TerraMap)
      : null;
  // Live run wins; else stored map; else last finished run / fixture.
  const map = analyze.running ? analyze.map : (storedMap ?? analyze.map ?? fixture);

  useEffect(() => {
    setSelectedIds([]);
    setElements([]);
  }, [map]);

  useEffect(() => {
    if (analyze.map) setStoredMap(null);
    const ac = new AbortController();
    analyses(ac.signal)
      .then((rows) => setHistory(toHistory(rows)))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setHistory([]);
      });
    return () => ac.abort();
  }, [analyze.map]);

  const open = async (entry: HistoryEntry) => {
    try {
      setStoredMap(await analysis(entry.id));
    } catch {
      /* leave stage as-is */
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
