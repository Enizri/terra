import { AnimatePresence, motion, type Transition } from "motion/react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import RepoDiagram from "../../shared/map/RepoDiagram";
import { rise, spring } from "../../shared/motion";
import { diagramEdges, diagramGroups, diagramNodes, type DiagramNode } from "./data";
import { TheaterModal, TheaterPanel } from "./theater";

export const MotionLink = motion.create(Link);

/* ---------- icons ---------- */

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

/** What Terra ingests: a branch, source, a shell invocation, a schema. */
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

/** Brand gradient rectangle — replaces the shuttle icon in nav / Final. */
export function TerraMark({ className }: { className?: string }) {
  return <span className={`sh-terra-mark${className ? ` ${className}` : ""}`} aria-hidden />;
}

export function WindowChrome({
  children,
  toolbar = true,
}: {
  children: ReactNode;
  /** Top chip bar (share). Off for the hero map so the diagram can breathe. */
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

/** "Web App" -> "WA", "Analyzer" -> "An": enough to tell nine components apart. */
function initials(label: string) {
  const words = label.split(" ");
  return words.length > 1
    ? words[0][0] + words[1][0]
    : label.slice(0, 2);
}

/**
 * Card face for a mapped component. Drawn in CSS rather than shipped as art —
 * the previous clone's thumbnails were photos, which read as the wrong product.
 * `icon="github"` swaps letters for the GitHub mark (hero drag card + twin).
 */
export function ComponentTile({
  label,
  layoutId,
  className,
  transition,
  icon,
  /** Opt out on the scroll-driven flight card — `layout` projection fights
      the translate and jitters right as the drag reaches the stage. */
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

/** Classic macOS arrow pointer — sits on the flight card to sell the drag. */
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

/** Repo window header: GitHub hub tile + repo title + "Map ready" badge.
    `receiveLayout` makes the tile the landing target of the hero flight
    card's shared-layout morph (layoutId "2"). */
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

/**
 * The repo map shown in the hero window after the paste drop. A left→right
 * flow: the app people touch, the boxed group of things that do the work, and
 * the place it all gets remembered.
 *
 * The renderer lives in map/RepoDiagram — this wrapper only owns what is
 * landing-specific: the theater a clicked card opens.
 *
 * `hoverOnly` (ops Map tab): hover traces wiring — no click / theater.
 */
export function RepoMapDiagram({
  receiveLayout,
  hoverOnly = false,
  showHeader = true,
}: {
  receiveLayout?: boolean;
  hoverOnly?: boolean;
  showHeader?: boolean;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  /** The card opened in place of the canvas, and its ⤢ escalation. */
  const [open, setOpen] = useState<DiagramNode | null>(null);
  const [escalated, setEscalated] = useState(false);

  const closePanel = () => {
    setOpen(null);
    setEscalated(false);
    setFocus(null);
  };

  return (
    <>
      <RepoDiagram
        nodes={diagramNodes}
        edges={diagramEdges}
        groups={diagramGroups}
        hoverOnly={hoverOnly}
        header={showHeader ? <RepoWindowHeader receiveLayout={receiveLayout} /> : undefined}
        selectedId={focus}
        onSelect={(id) => {
          setFocus(id);
          setOpen(id ? (diagramNodes.find((n) => n.id === id) ?? null) : null);
        }}
        remeasureKey={open}
        overlay={
          // Overlay, not a swap: the panel covers the whole diagram card —
          // header, canvas and legend — at its full size.
          <AnimatePresence initial={false}>
            {open && !escalated && (
              <TheaterPanel
                key="theater"
                node={open}
                className="sh-theater__panel--inline"
                onClose={closePanel}
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

/** Graphite the pencil lays down — trail strokes and the written word share it. */
export const PENCIL_INK = "#3c3733";

/** How far above its landing spot the star starts its descent, in vh. */
export const STAR_ENTRY_RISE_VH = 0.85;
/** Dock glide length, ms — matches the CSS transition on `.sh-backdrop`. */
export const STAR_DOCK_MS = 1600;
