import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { Component, TerraMap } from "../../features/architecture-map";
import type { LiveSelection } from "../../features/preview";
import { AskDock } from "../../features/ask";
import memosFixture from "../../data/memos.map.json";
import {
  analyses,
  analysis,
  deleteAnalysis,
  setModelChoice,
  type ModelChoice,
} from "../../features/analysis";
import { wsCache } from "./cache";
import { useAnalyze } from "./useAnalyze";
import { askSelection, nextSelection } from "./selection";
import { extractGitHubURL } from "./githubUrl";
import { toHistory, type HistoryEntry } from "./history";
import { WorkspaceHeader } from "../../shared/shell/WorkspaceHeader";
import { DemoBanner } from "../../shared/shell/DemoBanner";
import { Sidebar } from "../../shared/shell/Sidebar";
import { showFixture } from "../../shared/demo";
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
  const [railOpen, setRailOpen] = useState(wsCache.railOpen);
  const [dockOpen, setDockOpen] = useState(wsCache.dockOpen);
  /** Bumped when the map asks the dock for attention; see `askAbout`. */
  const [askPending, setAskPending] = useState<{ nonce: number; question?: string }>({
    nonce: 0,
  });

  const toggleRail = () =>
    setRailOpen((v) => {
      wsCache.railOpen = !v;
      return !v;
    });
  const toggleDock = () =>
    setDockOpen((v) => {
      wsCache.dockOpen = !v;
      return !v;
    });
  /** Keep deleted ids out of the rail until the server catches up / refetch lands. */
  const deletedIds = useRef(new Set<number>());
  const autoOpened = useRef(false);

  // A demo build seeds the memos map so an arriving visitor reads a real map
  // before pasting anything; dev keeps its `?fixture` opt-in. See shared/demo.
  const demo = import.meta.env.VITE_TERRA_DEMO === "1";
  const fixture = showFixture(search, import.meta.env.DEV, demo)
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
  const chooseModel = (choice: ModelChoice) => {
    wsCache.selectedModel = choice;
    setModelChoice({ modelId: choice.modelId, provider: choice.provider });
    setSessionModel(choice);
  };

  const open = async (entry: HistoryEntry) => {
    openAbort.current?.abort();
    const ac = new AbortController();
    openAbort.current = ac;
    // The session model is deliberately kept: opening a stored map is not a
    // new run, and Ask still has to name a model the host is serving.
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

  /** The one gesture from "I clicked this card" to "I asked about this card":
   *  make it the subject, make sure the dock is on screen, and hand the
   *  composer the cursor — or send the question outright when the panel's
   *  starter chips name one. */
  const askAbout = (id: string, question?: string) => {
    setSelectedIds((prev) => askSelection(prev, id));
    setDockOpen(() => {
      wsCache.dockOpen = true;
      return true;
    });
    setAskPending((prev) => ({ nonce: prev.nonce + 1, question }));
  };

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => map?.components.find((c) => c.id === id))
        .filter((c): c is Component => !!c),
    [selectedIds, map],
  );

  return (
    <div
      className={`sh-root sh-ws${railOpen ? "" : " is-rail-collapsed"}${
        dockOpen ? "" : " is-dock-hidden"
      }${demo ? " has-demo-banner" : ""}`}
    >
      <WorkspaceHeader
        slug={slug}
        title={map?.project.name}
        busy={analyze.running}
        mapped={!!map && !analyze.recommendation}
        railOpen={railOpen}
        dockOpen={dockOpen}
        onToggleRail={toggleRail}
        onToggleDock={toggleDock}
        onRepo={(raw) => analyze.start(extractGitHubURL(raw) ?? raw)}
      />
      {demo && <DemoBanner />}
      <Sidebar
        map={map}
        history={history}
        onSelect={select}
        onOpen={open}
        onRemove={remove}
        busy={analyze.running}
        collapsed={!railOpen}
        onExpand={toggleRail}
      />
      <DropStage
        analyze={analyze}
        map={map}
        selectedIds={selectedIds}
        onSelect={select}
        onAsk={askAbout}
        onElements={setElements}
        onModel={chooseModel}
      />
      <AskDock
        map={map}
        selected={selected}
        elements={elements}
        askReady={!!map && !analyze.partial}
        pending={askPending}
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
