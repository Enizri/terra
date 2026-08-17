import { AnimatePresence, motion, type Transition } from "motion/react";
import { useImperativeHandle, useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { RepoDiagram } from "../../features/architecture-map";
import { rise, spring } from "../../shared/motion";
import { diagramEdges, diagramGroups, diagramNodes, type DiagramNode } from "./data";
import {
  TheaterModal,
  TheaterPanel,
  type ChatMessage,
  type TheaterScriptHandle,
} from "./theater";

export const MotionLink = motion.create(Link);

/* ---------- icons ---------- */

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

/** Ingest icons for the drop zone. */
export function DropIcons() {
  return (
    <div className="sh-drop__icons">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7" cy="6" r="2" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="17" cy="9" r="2" />
        <path d="M7 8v8M17 11c0 3-4 3-6 4" />
      </svg>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
      </svg>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m7 10 2.5 2L7 14M12 15h5" />
      </svg>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
      </svg>
    </div>
  );
}

/* ---------- shared UI ---------- */

export function Picture({
  base,
  alt,
  className,
}: {
  base: string;
  alt: string;
  className?: string;
}) {
  return (
    <picture>
      <source type="image/webp" srcSet={`${base}.webp`} />
      <source type="image/png" srcSet={`${base}.png`} />
      <img
        src={`${base}.png`}
        alt={alt}
        className={className}
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}

/** Brand gradient mark. */
export function TerraMark({ className }: { className?: string }) {
  return <span className={`sh-terra-mark${className ? ` ${className}` : ""}`} aria-hidden />;
}

export function WindowChrome({
  children,
  toolbar = true,
}: {
  children: ReactNode;
  /** Top chip bar; off for the hero map. */
  toolbar?: boolean;
}) {
  return (
    <div className={`sh-window${toolbar ? "" : " sh-window--bare"}`}>
      {toolbar ? (
        <div className="sh-window__bar">
          <div className="sh-window__group" style={{ marginLeft: "auto" }}>
            <span className="sh-chip sh-chip--tint">
              Share map <ArrowIcon />
            </span>
          </div>
        </div>
      ) : null}
      {children}
      {toolbar ? (
        <div className="sh-zoom">
          <div className="sh-zoom__pill">
            <span>−</span>
            <em>90%</em>
            <span>+</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function initials(label: string) {
  const words = label.split(" ");
  return words.length > 1
    ? words[0][0] + words[1][0]
    : label.slice(0, 2);
}

/** Card face icon (`icon="github"` for the hero drag card). */
export function ComponentTile({
  label,
  layoutId,
  className,
  transition,
  icon,
  /** Disable layout on the scroll-driven flight card. */
  layout = true,
}: {
  label: string;
  layoutId?: string;
  className?: string;
  transition?: Transition;
  icon?: "github";
  layout?: boolean;
}) {
  return (
    <motion.div
      layoutId={layoutId}
      layout={layout && layoutId ? "position" : undefined}
      className={`sh-tile ${icon === "github" ? "sh-tile--github" : ""} ${className ?? ""}`}
      transition={transition}
      aria-label={label}
    >
      {icon === "github" ? (
        <img
          src="/images/logos/github-mark.svg"
          alt=""
          className="sh-tile__github"
          draggable={false}
        />
      ) : (
        initials(label)
      )}
    </motion.div>
  );
}

/** macOS arrow for the flight card. */
export function MacPointer({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="31"
      viewBox="0 0 18 22"
      aria-hidden
    >
      <path
        fill="#fff"
        stroke="#111"
        strokeWidth="1.2"
        strokeLinejoin="round"
        d="M1.2 1.2v15.6l3.9-3.8 2.5 6 2.2-.9-2.5-6h6.4L1.2 1.2z"
      />
    </svg>
  );
}

/** Repo window header; `receiveLayout` is the flight-card layout morph target. */
export function RepoWindowHeader({ receiveLayout }: { receiveLayout?: boolean }) {
  return (
    <motion.header
      className="sh-diagram__header"
      variants={rise}
      transition={spring}
    >
      <ComponentTile
        label="GitHub"
        layoutId={receiveLayout ? "2" : undefined}
        icon="github"
        className="sh-tile--diagram-hub"
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      />
      <div className="sh-diagram__title">
        <div className="sh-diagram__repo">usememos/memos</div>
        <div className="sh-diagram__meta">
          {diagramNodes.length} parts · read straight from the code
        </div>
      </div>
    </motion.header>
  );
}

/** Imperative map controls for the scripted hero film. */
export type RepoMapScriptHandle = {
  hoverNode(id: string | null): void;
  /** Opens the theater panel for a node id; null closes it. */
  openNode(id: string | null): void;
};

/** Landing repo map wrapper; opens theater on click unless `hoverOnly`. */
export function RepoMapDiagram({
  receiveLayout,
  hoverOnly = false,
  showHeader = true,
  scripted = false,
  scriptRef,
  theaterScriptRef,
  demoReplica,
  designMode = false,
  initialChat,
  legendNote,
  theaterHideDock = false,
}: {
  receiveLayout?: boolean;
  hoverOnly?: boolean;
  showHeader?: boolean;
  /** Scripted hero film: inert container, driven via the refs below. */
  scripted?: boolean;
  scriptRef?: Ref<RepoMapScriptHandle>;
  theaterScriptRef?: Ref<TheaterScriptHandle>;
  demoReplica?: "home" | "explore";
  designMode?: boolean;
  initialChat?: ChatMessage[];
  legendNote?: string;
  /** Chat lives outside the panel (workspace dock column). */
  theaterHideDock?: boolean;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const [open, setOpen] = useState<DiagramNode | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [scriptHover, setScriptHover] = useState<string | null>(null);

  const closePanel = () => {
    setOpen(null);
    setEscalated(false);
    setFocus(null);
  };

  useImperativeHandle(scriptRef, () => ({
    hoverNode: setScriptHover,
    openNode: (id: string | null) => {
      if (!id) {
        closePanel();
        return;
      }
      setFocus(id);
      setOpen(diagramNodes.find((n) => n.id === id) ?? null);
    },
  }));

  return (
    <>
      <RepoDiagram
        nodes={diagramNodes}
        edges={diagramEdges}
        groups={diagramGroups}
        hoverOnly={hoverOnly}
        header={showHeader ? <RepoWindowHeader receiveLayout={receiveLayout} /> : undefined}
        selectedId={focus}
        scripted={scripted}
        scriptHoverId={scripted ? scriptHover : null}
        legendNote={legendNote}
        onSelect={(id) => {
          setFocus(id);
          setOpen(id ? (diagramNodes.find((n) => n.id === id) ?? null) : null);
        }}
        remeasureKey={open}
        overlay={
          <AnimatePresence initial={false}>
            {open && !escalated && (
              <TheaterPanel
                key="theater"
                node={open}
                className="sh-theater__panel--inline"
                onClose={closePanel}
                demoReplica={demoReplica}
                designMode={designMode}
                scripted={scripted}
                scriptRef={theaterScriptRef}
                initialMessages={initialChat}
                hideDock={theaterHideDock}
              />
            )}
          </AnimatePresence>
        }
      />

      {/* Outside the diagram on purpose: portal events bubble the React tree,
          so mounting this inside it would route every theater click into the
          canvas' `select(null)`. */}
      <AnimatePresence>
        {open && escalated && (
          <TheaterModal node={open} onClose={() => setEscalated(false)} />
        )}
      </AnimatePresence>
    </>
  );
}


/* ---------- scroll-linked hero flights ---------- */

/** Graphite ink for pencil trail/headline. */
export const PENCIL_INK = "#3c3733";

/** Star descent start offset (vh). */
export const STAR_ENTRY_RISE_VH = 0.85;
/** Dock glide ms — match `.sh-backdrop` transition. */
export const STAR_DOCK_MS = 1600;
