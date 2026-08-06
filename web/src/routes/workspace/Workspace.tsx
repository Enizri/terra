import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { Component, TerraMap } from "../../shared/map/types";
import type { LiveSelection } from "../../shared/live";
import memosFixture from "../../data/memos.map.json";
import { useAnalyze } from "./useAnalyze";
import { nextSelection } from "./selection";
import { WorkspaceHeader } from "./sections/WorkspaceHeader";
import { Sidebar, type HistoryEntry } from "./sections/Sidebar";
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
  /** Session-only: every repo mapped in this tab, newest first. */
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ponytail: dev-only render harness — `?fixture` draws the golden memos map
  // with no Go server. Upgrade path: a real fixture picker if a second map lands.
  const fixture =
    import.meta.env.DEV && new URLSearchParams(search).has("fixture")
      ? (memosFixture as TerraMap)
      : null;
  // A live run always wins, so the URL form still works with the harness on.
  const map = analyze.running ? analyze.map : (analyze.map ?? fixture);

  useEffect(() => {
    setSelectedIds([]);
    setElements([]);
  }, [map]);

  // Re-mapping a repo moves it back to the top rather than listing it twice.
  useEffect(() => {
    if (!map) return;
    const entry = {
      repoUrl: map.project.repository_url,
      name: map.project.name,
      components: map.components.length,
    };
    setHistory((prev) => [entry, ...prev.filter((h) => h.repoUrl !== entry.repoUrl)].slice(0, 8));
  }, [map]);

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
        onReplay={analyze.start}
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
