import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { Component, TerraMap } from "../../features/architecture-map";
import type { LiveSelection } from "../../features/preview";
import { AskDock } from "../../features/ask";
import memosFixture from "../../data/memos.map.json";
import { analyses, analysis, deleteAnalysis } from "../../features/analysis";
import { wsCache } from "./cache";
import { useAnalyze } from "./useAnalyze";
import { nextSelection } from "./selection";
import { toHistory, type HistoryEntry } from "./history";
import { WorkspaceHeader } from "../../shared/shell/WorkspaceHeader";
import { Sidebar } from "../../shared/shell/Sidebar";
import { DropStage } from "./sections/Stage";
import { SessionModels } from "./sections/SessionModels";
import "../../shared/styles/tokens.css";
import "../../shared/styles/ui.css";
import "../../shared/shell/shell.css";

/** Workspace: analysis run, selection, and the mapped tab. */
export default function Workspace() {
  const { slug = "untitled" } = useParams();
  const { search } = useLocation();
  const analyze = useAnalyze();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [elements, setElements] = useState<LiveSelection[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>(wsCache.history ?? []);
  /** Stored map from the rail — no pipeline re-run. */
  const [storedMap, setStoredMap] = useState<TerraMap | null>(wsCache.storedMap);
  const [sessionModel, setSessionModel] = useState(wsCache.selectedModel);
  /** Keep deleted ids out of the rail until the server catches up / refetch lands. */
  const deletedIds = useRef(new Set<number>());
  const autoOpened = useRef(false);

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

  // A new run replaces whatever stored map is on stage. Keyed on `running`,
  // not `analyze.map`: the latter is seeded from wsCache on remount and would
  // wipe a stored map the user just opened (landing <-> workspace roundtrip).
  useEffect(() => {
    if (analyze.running) {
      setStoredMap(null);
      wsCache.storedMap = null;
    }
  }, [analyze.running]);

  useEffect(() => {
    // Cached history + no fresh run: keep what's on screen, skip the refetch.
    if (wsCache.history && !analyze.map) return;
    const ac = new AbortController();
    analyses(ac.signal)
      .then((rows) => {
        const h = toHistory(rows).filter((entry) => !deletedIds.current.has(entry.id));
        wsCache.history = h;
        setHistory(h);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        wsCache.history = null;
        setHistory([]);
      });
    return () => ac.abort();
  }, [analyze.map]);

  // Last click wins: abort the previous fetch so two rapid rail clicks can't
  // land out of order (and a late response can't set state after unmount).
  const openAbort = useRef<AbortController | null>(null);
  useEffect(() => () => openAbort.current?.abort(), []);
  const chooseModel = (choice: { modelId: string; apiKey?: string }) => {
    wsCache.selectedModel = choice;
    setSessionModel(choice);
  };

  const open = async (entry: HistoryEntry) => {
    openAbort.current?.abort();
    const ac = new AbortController();
    openAbort.current = ac;
    wsCache.selectedModel = null;
    setSessionModel(null);
    try {
      const m = await analysis(entry.id, ac.signal);
      wsCache.storedMap = m;
      setStoredMap(m);
    } catch {
      /* aborted or failed: leave stage as-is */
    }
  };

  // Entering the workspace with maps already in storage should land on the
  // newest one so the model picker can open against a real repo.
  useEffect(() => {
    if (autoOpened.current) return;
    if (map || analyze.running || analyze.recommendation) return;
    const latest = history[0];
    if (!latest) return;
    autoOpened.current = true;
    void open(latest);
    // open is recreated each render; the ref guard is the once-only rule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, map, analyze.running, analyze.recommendation]);

  const remove = async (entry: HistoryEntry) => {
    deletedIds.current.add(entry.id);
    let snapshot: HistoryEntry[] = [];
    setHistory((prev) => {
      snapshot = prev;
      const next = prev.filter((h) => h.id !== entry.id);
      wsCache.history = next;
      return next;
    });

    try {
      await deleteAnalysis(entry.id);
      if (storedMap?.project.repository_url === entry.repoUrl) {
        setStoredMap(null);
        wsCache.storedMap = null;
      }
    } catch (e) {
      deletedIds.current.delete(entry.id);
      setHistory(snapshot);
      wsCache.history = snapshot;
      console.error("Failed to remove analysis:", e);
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
      <WorkspaceHeader slug={slug} title={map?.project.name} busy={analyze.running} />
      <Sidebar
        map={map}
        history={history}
        onSelect={select}
        onOpen={open}
        onRemove={remove}
        busy={analyze.running}
      />
      <DropStage
        analyze={analyze}
        map={map}
        selectedIds={selectedIds}
        onSelect={select}
        onElements={setElements}
        onModel={chooseModel}
      />
      <AskDock
        map={map}
        selected={selected}
        elements={elements}
        askReady={!!map && !analyze.partial}
        model={sessionModel ?? undefined}
        modelPicker={
          map ? <SessionModels selected={sessionModel} onChoose={chooseModel} /> : null
        }
        onDropComponent={(id) => setSelectedIds((prev) => prev.filter((x) => x !== id))}
        onDropElement={(el) => setElements((prev) => prev.filter((x) => x !== el))}
      />
    </div>
  );
}
