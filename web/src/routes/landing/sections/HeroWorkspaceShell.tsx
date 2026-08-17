// Embedded workspace for the hero film: the real product chrome at a fixed
// logical resolution, scaled to fill the hero window. The map/preview/chat
// states mirror MapStage and AgentDock so the film reads as the real
// workspace. The pre-drop small screen lives in Hero.tsx, not here.

import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import memosFixture from "../../../data/memos.map.json";
import type { TerraMap } from "../../../features/architecture-map";
import { RepoDiagram } from "../../../features/architecture-map";
import { WorkspaceHeader } from "../../../shared/shell/WorkspaceHeader";
import { Sidebar } from "../../../shared/shell/Sidebar";
import { StatusLine } from "../../../shared/shell/StatusLine";
import "../../../shared/shell/shell.css";
import {
  TerraChatDock,
  TheaterPanel,
  type ChatMessage,
  type ChatScriptHandle,
  type TheaterScriptHandle,
} from "../theater";
import { diagramEdges, diagramGroups, diagramNodes } from "../data";

export type FilmPhase = "scan" | "map";

/** Imperative workspace-map controls for the film director. */
export type WsFilmHandle = {
  hoverNode(id: string | null): void;
  /** Select a card — violet focus ring, like a real click. */
  selectNode(id: string | null): void;
  /** Toggle the live-preview cover over the map. */
  openPreview(open: boolean): void;
};

/** Fixed logical width the workspace lays out at before scaling. */
const LOGICAL_W = 1440;

const fixtureMap = memosFixture as unknown as TerraMap;

const webNode = diagramNodes.find((n) => n.id === "web")!;

const noop = () => {};

/** Real workspace chrome around the film, inside a scale-to-fit layer. */
export function HeroWorkspaceShell({
  phase,
  filmRef,
  theaterRef,
  chatRef,
  scanLabel,
  elapsed,
  selKey,
  crumb,
  initialChat,
}: {
  phase: FilmPhase;
  filmRef: Ref<WsFilmHandle>;
  theaterRef: Ref<TheaterScriptHandle>;
  chatRef: Ref<ChatScriptHandle>;
  scanLabel: string;
  elapsed: number;
  selKey: string | null;
  crumb: string | null;
  initialChat?: ChatMessage[];
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [logicalH, setLogicalH] = useState(760);
  const [fit, setFit] = useState({ scale: 0.6 });
  const [scriptHover, setScriptHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useImperativeHandle(filmRef, () => ({
    hoverNode: setScriptHover,
    selectNode: setFocus,
    openPreview: setPreview,
  }));

  // Fit scale from the hero window.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const measure = () => {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      if (!vw || !vh) return;
      const scaleFit = vw / LOGICAL_W;
      setLogicalH(Math.round(vh / scaleFit));
      setFit({ scale: scaleFit });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [phase]);

  // Real AgentDock greeting copy for the current state.
  const greeting =
    phase === "map"
      ? "Memos is mapped. Click any box for its purpose, tech and files — shift-click to ask about several at once."
      : "Drop a repo and I'll answer questions about it — what talks to what, where a change lands, why a part exists.";

  return (
    <div className="sh-ws-embed" ref={viewportRef}>
      <div
        className="sh-ws-embed__scale"
        style={{ width: LOGICAL_W, height: logicalH, transform: `scale(${fit.scale})` }}
      >
        {/* is-preview collapses the rail so the replica gets the width. */}
        <div className={`sh-root sh-ws${preview ? " is-preview" : ""}`}>
          <WorkspaceHeader
            slug="usememos/memos"
            title={phase === "map" ? "Memos" : undefined}
            busy={phase === "scan"}
          />
          <Sidebar
            map={phase === "map" ? fixtureMap : null}
            history={[]}
            onSelect={noop}
            onOpen={noop}
            onRemove={noop}
            busy={phase === "scan"}
          />
          <main className={`sh-ws__stage${phase === "map" ? " is-map" : ""}`}>
            {phase === "scan" && (
              <div className="sh-ws__running">
                <StatusLine label={scanLabel} elapsed={elapsed} />
                <button type="button" className="sh-ws__stop">
                  Stop
                </button>
              </div>
            )}
            {phase === "map" && (
              <>
                {/* Mirrors MapStage's mapbar: stats, preview toggle, find box. */}
                <div className="sh-ws__mapbar">
                  <b>Memos</b>
                  <em>A privacy-first note-taking service</em>
                  <span className="sh-chip">6 components</span>
                  <span className="sh-chip">8 relationships</span>
                  <span className="sh-chip">Go · TypeScript</span>
                  <button
                    type="button"
                    className={`sh-chip sh-chip--btn${preview ? " is-on" : ""}`}
                    data-film="preview-chip"
                  >
                    {preview ? "Close preview" : "Live preview"}
                  </button>
                  <form className="sh-ws__find" onSubmit={(e) => e.preventDefault()}>
                    <input
                      className="sh-ws__find-input"
                      placeholder="Find a component"
                      aria-label="Find a component in the map"
                      readOnly
                    />
                  </form>
                </div>
                <div className="sh-ws__map">
                  <RepoDiagram
                    nodes={diagramNodes}
                    edges={diagramEdges}
                    groups={diagramGroups}
                    scripted
                    scriptHoverId={scriptHover}
                    selectedId={focus}
                    labelsOnHover
                    remeasureKey={preview}
                    legendNote="Hover a card to trace its wiring — click to open it, shift-click to stack up to three"
                    header={
                      <header className="sh-diagram__header">
                        <div className="sh-diagram__title">
                          <div className="sh-diagram__repo">github.com/usememos/memos</div>
                          <div className="sh-diagram__meta">
                            {diagramNodes.length} parts · read straight from the code
                          </div>
                        </div>
                      </header>
                    }
                  />
                </div>
                {/* Direct stage child, not inside the map box: inset 0 then
                    resolves against the stage's padding box, so the preview
                    also covers the mapbar row and the stage padding. */}
                {preview && (
                  <div className="sh-ws__preview">
                    <TheaterPanel
                      node={webNode}
                      onClose={noop}
                      className="sh-theater__panel--ws-preview"
                      demoReplica="home"
                      designMode
                      scripted
                      scriptRef={theaterRef}
                      hideDock
                    />
                  </div>
                )}
              </>
            )}
          </main>
          <div className="sh-ws__dock">
            <TerraChatDock
              wsSkin
              scripted
              scriptRef={chatRef}
              selectionKey={selKey}
              crumb={crumb}
              greeting={greeting}
              onAsk={async () => ""}
              hints={[]}
              designMode
              initialMessages={initialChat}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
