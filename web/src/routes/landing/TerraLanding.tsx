import {
  animate,
  AnimatePresence,
  LayoutGroup,
  motion,
  MotionConfig,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
  type Transition,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import RepoDiagram from "../../shared/map/RepoDiagram";
import HeroBackdrop from "./HeroBackdrop";
import {
  copy,
  diagramEdges,
  diagramGroups,
  diagramNodes,
  inView,
  rise,
  spring,
  stagger,
  users,
  type DiagramNode,
  type User,
} from "./data";
import {
  IMPLEMENT_HINTS,
  MemosExploreReplica,
  TheaterModal,
  TheaterPanel,
} from "./theater";
import "./terra.css";

/** Router Link that still takes motion props (CTA tap/scroll-in animations). */
const MotionLink = motion.create(Link);

/* ---------- icons ---------- */

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

/** What Terra ingests: a branch, source, a shell invocation, a schema. */
function DropIcons() {
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

function Picture({
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
function TerraMark({ className }: { className?: string }) {
  return <span className={`sh-terra-mark${className ? ` ${className}` : ""}`} aria-hidden />;
}

const navCollapseSpring = {
  type: "spring",
  stiffness: 500,
  damping: 60,
  mass: 1,
} as const;

/** Parker-style: collapse nav links on scroll down, expand on scroll up. */
function useNavCollapse() {
  const [collapsed, setCollapsed] = useState(false);
  const { scrollY } = useScroll();
  const lastY = useRef(0);
  const collapsedRef = useRef(false);

  useMotionValueEvent(scrollY, "change", (y) => {
    const delta = y - lastY.current;
    // Ignore sub-threshold jitter (layout/sticky can nudge scrollY a few px).
    if (Math.abs(delta) < 16 && y >= 24) return;
    lastY.current = y;

    let next = collapsedRef.current;
    if (y < 24) next = false;
    else if (delta > 0) next = true;
    else if (delta < 0) next = false;

    if (next !== collapsedRef.current) {
      collapsedRef.current = next;
      setCollapsed(next);
    }
  });

  return collapsed;
}

function SiteNav() {
  const collapsed = useNavCollapse();
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : navCollapseSpring;

  return (
    <nav className="sh-nav">
      <div className="sh-nav__pill">
        <a className="sh-nav__logo" href="#">
          <TerraMark className={collapsed ? "sh-terra-mark--collapsed" : ""} />
          <span>Terra</span>
        </a>
        <motion.div
          className="sh-nav__links"
          initial={false}
          animate={
            collapsed
              ? { width: 0, opacity: 0, marginInline: 0 }
              : { width: "auto", opacity: 1, marginInline: 0 }
          }
          transition={transition}
          aria-hidden={collapsed}
          style={{ pointerEvents: collapsed ? "none" : "auto" }}
        >
          <a className="sh-nav__link" href="#" tabIndex={collapsed ? -1 : undefined}>
            How it works
          </a>
          <a className="sh-nav__link" href="#" tabIndex={collapsed ? -1 : undefined}>
            Case study
          </a>
        </motion.div>
        <MotionLink
          className="sh-btn sh-btn--nav"
          to="/new"
          whileTap={reduce ? undefined : { scale: 0.98 }}
        >
          Try it <ArrowIcon />
        </MotionLink>
      </div>
    </nav>
  );
}

function WindowChrome({
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
function ComponentTile({
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
function MacPointer({ className }: { className?: string }) {
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
function RepoWindowHeader({ receiveLayout }: { receiveLayout?: boolean }) {
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
function RepoMapDiagram({
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

/**
 * Lerp follower matching He(value, 0.1, filesDropped): eases toward
 * the scroll value while dragging. Unlike useTime()-driven lerps, this only
 * schedules RAF while catching up — freezing/idle stops the frame loop so
 * scroll GPU spikes don't keep burning after the cards land.
 */
function useLerp(source: MotionValue<number>, factor = 0.1, frozen = false) {
  const out = useMotionValue(source.get());
  const current = useRef(source.get());

  useEffect(() => {
    if (frozen) {
      // Snap to the scroll target so the shared-layout morph starts on-spot,
      // not from a lagged mid-ease pose.
      const target = source.get();
      current.current = target;
      out.set(target);
      return;
    }

    let frame: number | null = null;

    const stop = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    };

    const tick = () => {
      frame = null;
      const target = source.get();
      current.current += (target - current.current) * factor;
      out.set(current.current);
      // Snap once we're within a pixel — lingering sub-pixel chase reads as
      // jitter when the card is almost at the stage center.
      if (Math.abs(target - current.current) > 0.5) {
        frame = requestAnimationFrame(tick);
      } else {
        current.current = target;
        out.set(target);
      }
    };

    const kick = () => {
      if (frame === null) frame = requestAnimationFrame(tick);
    };

    const unsub = source.on("change", kick);
    kick();
    return () => {
      unsub();
      stop();
    };
  }, [source, factor, frozen, out]);

  return out;
}

/** Flight ease — light trail so scroll feels continuous, not stepped.
    Kept relatively snappy near the end so the card doesn't rubber-band into
    the stage center while the shared-layout morph is about to take over. */
const HERO_FLIGHT_LERP = 0.15;

/** Hero flight tile edge length — keep in sync with `.sh-tile--flight`. */
const FLIGHT_TILE_PX = 148;

/** One graphite texture for everything drawn by hand — the hero trail and the
    pencilled "humans" must read as the same tool on the same paper. */
function PencilDefs() {
  return (
    <svg className="sh-pencil-defs" aria-hidden>
      <filter id="sh-pencil" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="7" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

/** Graphite the pencil lays down — trail strokes and the written word share it. */
const PENCIL_INK = "#3c3733";

/** How far ahead of the card the pencil line runs, as a share of the path. */
const TRAIL_LEAD = 0.24;

/** Fill speed relative to the drag — >1 so the pencil pulls further ahead. */
const TRAIL_FILL_RATE = 0.95;

/** Where the trail points: just above the drop window's label. */
const TRAIL_END_Y = -170;

/** Sideways nudge on the trail's end so the arrow sits over the drop target. */
const TRAIL_END_X = 6;

/** Arrowhead at the trail's end — sketched open, like the line itself. */
const ARROW_D =
  `M ${TRAIL_END_X - 13} ${TRAIL_END_Y - 16}` +
  ` L ${TRAIL_END_X} ${TRAIL_END_Y}` +
  ` L ${TRAIL_END_X + 12} ${TRAIL_END_Y - 19}`;

/**
 * Pencil-sketched curl from the parked GitHub card down into the repo window,
 * so the drag reads as "scroll and this lands in there" before anything moves.
 * Coordinates share the stage-centered origin used by `.sh-flight`.
 */
function DragTrail({
  start,
  progress,
}: {
  start: { x: number; y: number };
  progress: MotionValue<number>;
}) {
  const reduced = useReducedMotion();
  // Card bottom edge → a loop under it → long swoop into the window.
  const sx = start.x;
  const sy = start.y + FLIGHT_TILE_PX / 2 + 16;
  const d =
    `M ${sx} ${sy}` +
    ` C ${sx + 62} ${sy + 54}, ${sx + 78} ${sy + 150}, ${sx + 4} ${sy + 158}` +
    ` C ${sx - 62} ${sy + 165}, ${sx - 54} ${sy + 74}, ${sx + 22} ${sy + 104}` +
    ` C ${sx + 96} ${sy + 133}, ${sx + 40} ${sy + 250}, ${sx * 0.45} ${sy + 300}` +
    ` C ${sx * 0.12} ${TRAIL_END_Y - 150}, ${sx * 0.06 + TRAIL_END_X} ${TRAIL_END_Y - 60}, ${TRAIL_END_X} ${TRAIL_END_Y}`;
  // The line draws itself as the card travels, staying TRAIL_LEAD ahead so it
  // reads as leading the card in rather than trailing behind it.
  const drawn = useTransform(progress, (p) =>
    reduced ? 1 : Math.min(1, TRAIL_LEAD + p * TRAIL_FILL_RATE),
  );
  // Only clears once the card has landed — until then it is the route.
  const opacity = useTransform(progress, [0, 0.88, 1], [1, 1, 0]);
  // Arrow lands when the pencil reaches the window, not before.
  const arrowOpacity = useTransform(drawn, [0.9, 1], [0, 0.62]);
  const stroke = { fill: "none", stroke: PENCIL_INK, strokeLinecap: "round" } as const;
  return (
    <motion.svg
      className="sh-trail"
      width="1"
      height="1"
      overflow="visible"
      aria-hidden
      style={{ opacity }}
    >
      <g filter="url(#sh-pencil)">
        {/* Faint guide: the whole route — arrowhead included — is visible from
            the start, so the destination reads before anything is dragged. */}
        <path d={d} {...stroke} strokeWidth={1.6} opacity={0.2} />
        <path d={ARROW_D} {...stroke} strokeWidth={1.6} opacity={0.2} />
        {/* Pencil fills that guide in as the card is dragged, running ahead of it. */}
        <motion.path d={d} {...stroke} strokeWidth={5} opacity={0.14} style={{ pathLength: drawn }} />
        <motion.path d={d} {...stroke} strokeWidth={2.4} opacity={0.68} style={{ pathLength: drawn }} />
        {/* Hand-drawn arrowhead, sketched twice like a real pencil stroke. */}
        {/* Arrowhead only once the drawing has actually reached the window. */}
        <motion.g style={{ opacity: arrowOpacity }}>
          <path d={ARROW_D} {...stroke} strokeWidth={2.4} />
          <path d={`M -10 ${TRAIL_END_Y - 20} L 1 ${TRAIL_END_Y - 3}`} {...stroke} strokeWidth={1.4} opacity={0.5} />
        </motion.g>
      </g>
    </motion.svg>
  );
}

function FlightFile({
  index,
  progress,
  dropped,
  start,
}: {
  index: number;
  progress: MotionValue<number>;
  dropped: boolean;
  /** Stage-centered px at progress 0 (title-side park). Ends at 0,0. */
  start: { x: number; y: number };
}) {
  // Ref so resize-measured start updates without rebuilding the transform.
  const startRef = useRef(start);
  startRef.current = start;
  const xRaw = useTransform(progress, (p) => startRef.current.x * (1 - p));
  const yRaw = useTransform(progress, (p) => startRef.current.y * (1 - p));
  const x = useLerp(xRaw, HERO_FLIGHT_LERP, dropped);
  const y = useLerp(yRaw, HERO_FLIGHT_LERP, dropped);
  // A transform template (rather than x/y props) lets the `rise` variant supply
  // opacity without its translateY overwriting the scroll-driven position.
  const transform = useMotionTemplate`translate3d(${x}px, ${y}px, 0)`;
  const layoutId = String(index + 1);
  return (
    <motion.div
      className="sh-flight"
      style={{ transform }}
      animate={{ opacity: dropped ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="sh-flight__inner">
        {/* GitHub mark + shared layoutId so it morphs into the window twin. */}
        <ComponentTile
          label="GitHub"
          layoutId={layoutId}
          icon="github"
          className="sh-tile--flight"
          layout={false}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
        {/* Mac arrow rides the card so scroll reads as a drag. */}
        <MacPointer className="sh-flight__pointer" />
      </div>
    </motion.div>
  );
}

/** Safety net: force "humans" if the sequence stalls, in ms. */
const SWAP_FALLBACK_AFTER = 8000;

/* ---------- eraser → pencil word swap ----------
   The headline corrects itself by hand: an eraser rubs "engineers" off the
   line left→right, then a pencil writes "humans" back into the empty slot. */

/** Beat before the hand shows up, ms — the line reads as written first. */
const SWAP_LEAD_IN = 1100;
/** Eraser sweep, s. */
const ERASE_S = 1.05;
/** Pause on the empty slot before the pencil arrives, ms. */
const SWAP_GAP = 260;
/** Pencil write, s. */
const WRITE_S = 1.0;

/** How far above its landing spot the star starts its descent, in vh. */
const STAR_ENTRY_RISE_VH = 0.85;
/** Dock glide length, ms — matches the CSS transition on `.sh-backdrop`. */
const STAR_DOCK_MS = 1600;
/** Eraser sprite — rubber block on a tilt, seen edge-on over the line. */
function EraserSprite() {
  return (
    <svg className="sh-erase__tool" width="74" height="58" viewBox="0 0 74 58" aria-hidden>
      <g transform="rotate(-14 37 29)">
        <rect x="14" y="6" width="46" height="30" rx="5" fill="#e8a0a0" stroke="#3c3733" strokeWidth="2" />
        <path d="M14 24 h46" stroke="#3c3733" strokeWidth="1.6" opacity="0.55" />
        <rect x="14" y="24" width="46" height="12" rx="5" fill="#d98b8b" opacity="0.7" />
      </g>
    </svg>
  );
}

/** Pencil sprite — tip sits at the sprite origin so it rides the write edge. */
function PencilSprite() {
  return (
    <svg className="sh-write__tool" width="96" height="96" viewBox="0 0 96 96" aria-hidden>
      <g transform="rotate(38 12 84)">
        {/* tip at (12,84) */}
        <path d="M12 84 l6 -18 l10 6 z" fill="#3c3733" />
        <path d="M18 66 l10 6 l6 -12 l-10 -6 z" fill="#f0d9a8" stroke="#3c3733" strokeWidth="1.4" />
        <path d="M24 54 l10 6 l26 -50 l-10 -6 z" fill="#e8b45c" stroke="#3c3733" strokeWidth="1.6" />
        <path d="M29 45 l10 6" stroke="#3c3733" strokeWidth="1.4" opacity="0.6" />
      </g>
    </svg>
  );
}

/**
 * The headline states the problem, then rewrites itself into the promise:
 * "…only engineers can understand" becomes "…only humans can understand".
 * An eraser rubs "engineers" off the line, then a pencil writes "humans" in.
 */
function HeroTitle() {
  const t = copy.heroTitle;
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<"before" | "erase" | "write" | "done">("before");
  const fallbackRef = useRef(0);

  // 0→1 sweeps across the word slot, left to right, for both passes.
  const erase = useMotionValue(0);
  const write = useMotionValue(0);

  /** Force "humans" onto the line and end the sequence. */
  const settle = useCallback(() => {
    clearTimeout(fallbackRef.current);
    erase.set(1);
    write.set(1);
    setStage("done");
    // Job done — the star glides a bit further left (CSS transition on
    // `translate`, independent of the Motion-driven rotate).
    document.querySelector(".sh-backdrop")?.classList.add("sh-backdrop--parked");
  }, [erase, write]);

  useEffect(() => {
    if (reduced !== false) return;
    let cancelled = false;
    const timers: number[] = [];
    // Wait for the webfont: erasing a fallback-metric word leaves the sweep
    // out of step with the glyphs it is supposed to be rubbing out.
    const start = () => {
      if (cancelled) return;
      timers.push(
        window.setTimeout(() => {
          setStage("erase");
          animate(erase, 1, {
            duration: ERASE_S,
            ease: [0.5, 0, 0.5, 1],
            onComplete: () => {
              if (cancelled) return;
              timers.push(
                window.setTimeout(() => {
                  setStage("write");
                  animate(write, 1, {
                    duration: WRITE_S,
                    ease: [0.35, 0, 0.35, 1],
                    onComplete: () => !cancelled && settle(),
                  });
                }, SWAP_GAP),
              );
            },
          });
        }, SWAP_LEAD_IN),
      );
    };
    if (!document.fonts || document.fonts.status === "loaded") start();
    else void document.fonts.ready.then(start);

    // Safety net: if the sequence ever stalls, put the promise on the line.
    fallbackRef.current = window.setTimeout(settle, SWAP_FALLBACK_AFTER);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      clearTimeout(fallbackRef.current);
    };
  }, [reduced, erase, write, settle]);

  // Percent-based clips + sprite offsets: the word span is its own reference
  // box, so nothing here needs measuring on resize or font swap.
  const erasePct = useTransform(erase, (p) => p * 100);
  const writePct = useTransform(write, (p) => p * 100);
  // Overshoot vertically so descenders and the cap-height aren't clipped flat.
  const eraseClip = useMotionTemplate`inset(-35% -8% -35% ${erasePct}%)`;
  const writeRemain = useTransform(write, (p) => (1 - p) * 100);
  const eraseRemain = useTransform(erase, (p) => (1 - p) * 100);
  const writeClip = useMotionTemplate`inset(-35% ${writeRemain}% -35% -8%)`;
  // Smudge trails the eraser: only the part already rubbed shows graphite dust.
  const smudgeClip = useMotionTemplate`inset(-35% ${eraseRemain}% -35% -8%)`;
  const eraseLeft = useMotionTemplate`${erasePct}%`;
  const writeLeft = useMotionTemplate`${writePct}%`;
  // Scrubbing wobble so the eraser reads as a hand, not a wipe mask.
  const eraseTilt = useTransform(erase, (p) => Math.sin(p * Math.PI * 6) * 7);
  const eraseLift = useTransform(erase, (p) => Math.sin(p * Math.PI * 6) * 4);
  // Pencil bobs with the letters it is laying down.
  const writeLift = useTransform(write, (p) => Math.sin(p * Math.PI * 5) * 3);

  const showOld = reduced ? false : stage === "before" || stage === "erase";
  const showNew = reduced ? true : stage === "write" || stage === "done";

  return (
    <motion.h2
      className="sh-hero-title"
      variants={stagger}
      data-hand-done={stage === "done" || reduced ? "1" : "0"}
      data-reduced={reduced === null ? "pending" : reduced ? "1" : "0"}
    >
      <PencilDefs />
      <motion.span variants={rise}>{t.lead}</motion.span>
      <br />
      <motion.span variants={rise} className="sh-hero-title__swap-anchor">
        <span className="sh-hero-title__swap">
          <span className="sh-hero-title__sizer" aria-hidden>
            {t.from.length >= t.to.length ? t.from : t.to}
          </span>
          {showOld && (
            <span className="sh-hero-title__word sh-hero-title__word--cap">
              <motion.span className="sh-hero-title__ink" style={{ clipPath: eraseClip }}>
                {t.from}
              </motion.span>
              {/* Rubbed-off graphite left behind the eraser. */}
              <motion.span
                className="sh-hero-title__smudge"
                aria-hidden
                style={{ clipPath: smudgeClip }}
              >
                {t.from}
              </motion.span>
              {stage === "erase" && (
                <motion.span
                  className="sh-hand sh-hand--erase"
                  aria-hidden
                  style={{ left: eraseLeft, rotate: eraseTilt, y: eraseLift }}
                >
                  <EraserSprite />
                </motion.span>
              )}
            </span>
          )}
          {showNew && (
            <span className="sh-hero-title__word">
              <motion.span
                className="sh-hero-title__ink sh-hero-title__ink--pencil"
                style={reduced ? undefined : { clipPath: writeClip }}
              >
                {t.to}
              </motion.span>
              {stage === "write" && (
                <motion.span
                  className="sh-hand sh-hand--write"
                  aria-hidden
                  style={{ left: writeLeft, y: writeLift }}
                >
                  <PencilSprite />
                </motion.span>
              )}
            </span>
          )}
        </span>
      </motion.span>
      <br />
      <motion.span variants={rise}>{t.tail}</motion.span>
    </motion.h2>
  );
}

/** Min top clearance when the framed card is taller than the viewport. */
const LANDING_GAP_MIN = 56;
/** Extra scroll after the screen is framed that finishes the GitHub drag. */
const HERO_DRAG_TAIL_PX = 380;
/** Extra scroll while sticky after drop so the repo map can fully assemble. */
const HERO_HOLD_PX = 720;

/** Progress past which drag geometry (start vector + pin) is frozen.
    Remeasuring after the title scrolls away warps the path and jitters the
    card right as it reaches the stage. */
const FLIGHT_LOCK_PROGRESS = 0.04;
/** Drop engages at 1; only undrop below this so the map↔drop swap doesn't
    chatter when scroll sits on the threshold. */
const FLIGHT_UNDROP_PROGRESS = 0.9;

function Hero() {
  const pinRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  // Star spin is a pure-CSS animation on .sh-backdrop__spin (terra.css) —
  // compositor-only, paused while the star is hidden. No JS per frame.
  const stageRef = useRef<HTMLDivElement>(null);
  // Invisible slot beside the headline — flight parks here at progress 0.
  const flightAnchorRef = useRef<HTMLDivElement>(null);
  const [filesDropped, setFilesDropped] = useState(false);
  const [heroHeight, setHeroHeight] = useState(0);
  // Scroll Y where the GitHub drag finishes (frame + slow sticky tail).
  const [dragEndScroll, setDragEndScroll] = useState(1);
  // Stage-centered start so the card sits next to the title, not a fixed guess.
  const [flightStart, setFlightStart] = useState({ x: 400, y: -420 });
  // Once the drag is underway, ignore layout remeasures — the park anchor
  // leaves the viewport and would rewrite the trajectory every frame.
  const dragGeomLocked = useRef(false);
  // Sticky pin (not fixed/absolute swaps): native scroll blends through
  // free → framed → hold → release with no JS position thrashing.
  const { scrollY } = useScroll();

  useLayoutEffect(() => {
    const measure = () => {
      const pin = pinRef.current;
      const hero = heroRef.current;
      const stage = stageRef.current;
      if (!pin || !hero || !stage) return;

      // Mid-drag / post-drop: stage height flips when the map mounts, and the
      // title-side park anchor has scrolled away. Updating stick/start here
      // makes the GitHub card jitter right as it lands.
      if (dragGeomLocked.current) return;

      const stageOffset = stage.offsetTop;
      // Vertically center the repo window in the viewport once sticky frames.
      const gap = Math.max(
        LANDING_GAP_MIN,
        Math.round((window.innerHeight - stage.offsetHeight) / 2),
      );
      // Negative sticky top pulls the hero up so the stage sits at `gap`
      // once sticky engages — title scrolls away, screen card stays framed.
      const stickTop = gap - stageOffset;
      hero.style.setProperty("--hero-stick-top", `${stickTop}px`);

      setHeroHeight(hero.offsetHeight);

      // Sticky engages when the stage would sit at `gap`.
      const frameAt = Math.max(1, pin.offsetTop + stageOffset - gap);
      setDragEndScroll(frameAt + HERO_DRAG_TAIL_PX);

      // Park the GitHub card on the title-side anchor (stage uses left/top 50%).
      const anchor = flightAnchorRef.current;
      if (anchor) {
        const ar = anchor.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        const stageCx = sr.left + sr.width / 2;
        const stageCy = sr.top + sr.height / 2;
        setFlightStart({
          x: Math.round(ar.left + ar.width / 2 - stageCx),
          y: Math.round(ar.top + ar.height / 2 - stageCy),
        });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (heroRef.current) observer.observe(heroRef.current);
    if (stageRef.current) observer.observe(stageRef.current);
    if (flightAnchorRef.current) observer.observe(flightAnchorRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Continuous scrub — no phase cuts in the progress curve.
  const scrollYProgress = useTransform(scrollY, [0, dragEndScroll], [0, 1]);

  // Lock geometry once the drag leaves the park; hysteresis on the drop so
  // the map mount doesn't fight the flight card at the threshold.
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (v >= FLIGHT_LOCK_PROGRESS) dragGeomLocked.current = true;
    else if (v <= 0.005) dragGeomLocked.current = false;

    setFilesDropped((prev) => {
      const next = prev ? v >= FLIGHT_UNDROP_PROGRESS : v >= 1;
      return prev === next ? prev : next;
    });
  });
  useEffect(() => {
    const v = scrollYProgress.get();
    if (v >= FLIGHT_LOCK_PROGRESS) dragGeomLocked.current = true;
    setFilesDropped(v >= 1);
  }, [scrollYProgress]);

  const pinHeight =
    heroHeight > 0
      ? heroHeight + HERO_DRAG_TAIL_PX + HERO_HOLD_PX
      : undefined;

  return (
    <div ref={pinRef} className="sh-hero-pin" style={{ height: pinHeight }}>
      <motion.section
        ref={heroRef}
        className="sh-section sh-section--hero"
        data-dropped={filesDropped ? "1" : "0"}
        initial="hidden"
        animate="show"
        variants={stagger}
      >
        <HeroBackdrop />
        <div className="sh-copy sh-copy--hero">
          <div className="sh-hero-head">
            <HeroTitle />
            {/* Measured park for the flight card — sits just right of the title. */}
            <div
              ref={flightAnchorRef}
              className="sh-flight-anchor"
              style={{ width: FLIGHT_TILE_PX, height: FLIGHT_TILE_PX }}
              aria-hidden
            />
          </div>
          <motion.p className="sh-p1" variants={rise}>
            {copy.heroSubtitle}
          </motion.p>
        </div>

        <LayoutGroup>
          <div className="sh-stage" ref={stageRef}>
            <motion.div className="sh-window-wrap" variants={rise}>
              <WindowChrome toolbar={false}>
                <AnimatePresence mode="popLayout" initial={false}>
                  {!filesDropped ? (
                    <motion.div
                      key="drop"
                      className="sh-drop"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                    >
                      <DropIcons />
                      <div className="sh-drop__label">Paste a repo URL</div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="folders"
                      className="sh-window-body"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                    >
                      <RepoMapDiagram receiveLayout hoverOnly />
                    </motion.div>
                  )}
                </AnimatePresence>
              </WindowChrome>
            </motion.div>

            {/* One right-side flight card stays mounted after the drop: Motion
                needs both the flying card and its grid twin alive to run the
                shared-layout morph that lands the file inside the window. */}
            {!filesDropped && <DragTrail start={flightStart} progress={scrollYProgress} />}

            <AnimatePresence>
              {users.slice(1, 2).map((u) => (
                <FlightFile
                  key={`f-${u.id}`}
                  index={1}
                  progress={scrollYProgress}
                  dropped={filesDropped}
                  start={flightStart}
                />
              ))}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </motion.section>
    </div>
  );
}

/* ---------- sections ---------- */

// Evidence panel moved into the theater's Files tab — the old always-on
// PreviewCard overlay sat on top of the diagram and swallowed card clicks.

/** Preview + Terra chat for Ask / Implement ops tabs. */
function OpsPreview({
  chatHints,
  designMode = false,
  exploreReplica = false,
}: {
  chatHints?: readonly string[];
  designMode?: boolean;
  /** Implement: clickable Memos explore UI (not the live Ask iframe). */
  exploreReplica?: boolean;
}) {
  const web = diagramNodes.find((n) => n.id === "web")!;
  return (
    <TheaterPanel
      node={web}
      onClose={() => {}}
      className="sh-theater__panel--inline"
      chatHints={chatHints}
      designMode={designMode}
      exploreReplica={exploreReplica}
    />
  );
}

type OpsTabId = (typeof copy.ops)[number]["id"] | "map";

const OPS_TABS: { id: OpsTabId; label: string }[] = [
  ...copy.ops.map((o) => ({ id: o.id as OpsTabId, label: o.label })),
  { id: "map", label: "Map" },
];

/** Tabbed ops screen for Power of Terra. Controlled from the theater so the
    Railway-style tab bar can sit on the wallpaper strip below the screen. */
function OpsStage({
  active,
  mounted,
  caption = true,
}: {
  active: OpsTabId;
  mounted: ReadonlySet<OpsTabId>;
  caption?: boolean;
}) {
  const op = copy.ops.find((o) => o.id === active);

  const pane = (id: OpsTabId, node: ReactNode) =>
    mounted.has(id) ? (
      <div
        key={id}
        className={`sh-ops__pane${active === id ? " is-active" : ""}`}
        aria-hidden={active !== id}
        // Keep the live iframe in the tree when inactive — unmounting it
        // re-hits /preview and shows "Starting the dev server…" again.
        inert={active !== id ? true : undefined}
      >
        {node}
      </div>
    ) : null;

  return (
    <motion.div className="sh-ops" variants={rise}>
      <div className="sh-ops__frame">
        <div className="sh-ops__state">
          {pane("ask", <OpsPreview />)}
          {pane(
            "implement",
            <OpsPreview chatHints={IMPLEMENT_HINTS} designMode exploreReplica />,
          )}
          {pane("map", <RepoMapDiagram hoverOnly showHeader={false} />)}
          {pane(
            "monitor",
            <div className="sh-opstate sh-opstate--soon">
              <p>
                {copy.ops.find((o) => o.id === "monitor")?.caption}
              </p>
              <span className="sh-opstate__pill">Demo coming soon</span>
            </div>,
          )}
        </div>
      </div>
      {caption && op && (
        <p className="sh-ops__caption" key={op.id}>
          {op.caption}
        </p>
      )}
    </motion.div>
  );
}

/** Pencil curl off the Power title, same graphite as the hero trail, with
    "Try it" written beside it — points down at the ops tabs below. */
function TryItNote() {
  const reduced = useReducedMotion();
  const d =
    "M 24 30 C 74 14, 124 36, 120 78" +
    " C 116 116, 68 122, 62 94" +
    " C 57 70, 98 62, 112 94" +
    " C 132 140, 112 226, 52 300";
  const head = "M 78 286 L 51 302 L 47 268";
  const stroke = { fill: "none", stroke: PENCIL_INK, strokeLinecap: "round" } as const;
  const draw = reduced
    ? {}
    : {
        initial: { pathLength: 0 },
        whileInView: { pathLength: 1 },
        viewport: { once: true, amount: 0.6 },
        transition: { duration: 1.1, ease: "easeInOut" as const },
      };
  return (
    <svg className="sh-tryit" viewBox="0 0 176 320" aria-hidden overflow="visible">
      <g filter="url(#sh-pencil)" opacity={0.72}>
        <motion.path d={d} {...stroke} strokeWidth={2.4} {...draw} />
        <motion.path
          d={head}
          {...stroke}
          strokeWidth={2.2}
          {...draw}
          transition={{ ...draw.transition, delay: 0.9, duration: 0.3 }}
        />
        <text className="sh-tryit__word" x="4" y="16" transform="rotate(-7 4 16)">
          Try it
        </text>
      </g>
    </svg>
  );
}

function PowerSection() {
  const [active, setActive] = useState<OpsTabId>("ask");
  // Keep-alive: once a tab has been opened, leave its tree mounted.
  const [mounted, setMounted] = useState<ReadonlySet<OpsTabId>>(
    () => new Set<OpsTabId>(["ask"]),
  );

  const selectTab = (id: OpsTabId) => {
    setActive(id);
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  return (
    <motion.section
      className="sh-section"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      <div className="sh-copy sh-copy--section" style={{ position: "relative" }}>
        <motion.h3 className="sh-section-title sh-section-title--note" variants={rise}>
          {copy.powerTitle}
          <TryItNote />
        </motion.h3>
        <motion.p className="sh-p1" variants={rise}>
          {copy.power}
        </motion.p>
      </div>

      <div className="sh-stage sh-stage--power">
        <motion.div className="sh-window-wrap" variants={rise}>
          <div className="sh-power-theater">
            <img
              className="sh-power-theater__wallpaper"
              src="/images/theater/power-wallpaper.jpg"
              alt=""
              aria-hidden
              draggable={false}
            />
            <div className="sh-power-theater__screen">
              <WindowChrome toolbar={false}>
                <div className="sh-window-body">
                  <motion.div
                    className="sh-diagram sh-power-ops"
                    initial="hidden"
                    animate="show"
                  >
                    <RepoWindowHeader />
                    <OpsStage active={active} mounted={mounted} caption={false} />
                  </motion.div>
                </div>
              </WindowChrome>
            </div>
            {/* Tab bar sits on the wallpaper strip below the product screen. */}
            <div
              className="sh-ops__tabs sh-power-theater__tabs"
              role="tablist"
              aria-label="Terra operations"
            >
              {OPS_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active === t.id}
                  className={`sh-ops__tab${active === t.id ? " is-active" : ""}`}
                  onClick={() => selectTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}

/* ---------- Terra playground (last screen) ----------
   A looping "film" of the team editing the Memos UI together: named cursors
   take turns pointing at a piece of the interface, asking for a change, and
   the UI restyles itself live. Pure state machine — one interval steps a
   scripted timeline, CSS transitions do the actual restyling. */

/** One beat of the loop, ms. */
const PLAY_STEP_MS = 1400;
/** Steps in the loop — last one resets the UI so the film can replay. */
const PLAY_STEPS = 7;

/** Cursor colors — match the users' avatar rings (bg-amber / indigo / green). */
const PLAY_HEX: Record<string, string> = {
  "1": "#f59e0b",
  "3": "#6366f1",
  "4": "#22c55e",
};

type PlayCursor = {
  user: User;
  /** [x%, y%] inside the window, one waypoint per step. */
  path: [number, number][];
  /** step → chat bubble spoken at that waypoint. */
  say: Record<number, string>;
};

const PLAY_CURSORS: PlayCursor[] = [
  {
    user: users[0], // Giel → the nav rail
    path: [[68, 66], [3, 38], [3, 42], [6, 56], [9, 62], [11, 58], [60, 70]],
    // Announce one step before the edit lands, hold the bubble through it.
    say: { 1: "Paint the nav brand orange", 2: "Paint the nav brand orange" },
  },
  {
    user: users[2], // Niels → the memo cards
    path: [[42, 14], [48, 20], [54, 32], [56, 30], [58, 38], [50, 48], [44, 20]],
    say: { 3: "Rounder cards, please", 4: "Rounder cards, please" },
  },
  {
    user: users[3], // Jeroen → the activity heatmap
    path: [[86, 78], [80, 68], [70, 58], [40, 54], [19, 42], [16, 38], [80, 74]],
    say: { 4: "Light up the activity graph", 5: "Light up the activity graph" },
  },
];

function PlayCursorSprite({ c, step }: { c: PlayCursor; step: number }) {
  const [x, y] = c.path[step];
  const msg = c.say[step];
  const hex = PLAY_HEX[c.user.id];
  return (
    <motion.div
      className="sh-play-cursor"
      initial={false}
      animate={{ left: `${x}%`, top: `${y}%` }}
      transition={{ type: "spring", stiffness: 80, damping: 17 }}
    >
      <svg width="20" height="24" viewBox="0 0 18 22" aria-hidden>
        <path
          fill={hex}
          stroke="#fff"
          strokeWidth="1.2"
          strokeLinejoin="round"
          d="M1.2 1.2v15.6l3.9-3.8 2.5 6 2.2-.9-2.5-6h6.4L1.2 1.2z"
        />
      </svg>
      <span className="sh-play-cursor__name" style={{ background: hex }}>
        {c.user.name}
      </span>
      <AnimatePresence>
        {msg && (
          <motion.span
            key={msg}
            className="sh-play-cursor__say"
            style={{ borderColor: hex }}
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {msg}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PlaygroundStage() {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setTick((s) => (s + 1) % PLAY_STEPS), PLAY_STEP_MS);
    return () => clearInterval(id);
  }, [reduced]);
  // Reduced motion: hold the fully-edited frame instead of playing the film.
  const step = reduced ? 5 : tick;

  return (
    <div
      className="sh-playground"
      data-edit-nav={step >= 2 && step <= 5 ? "1" : "0"}
      data-edit-cards={step >= 4 && step <= 5 ? "1" : "0"}
      data-edit-heat={step === 5 ? "1" : "0"}
      data-aim={step === 1 ? "nav" : step === 3 ? "cards" : step === 5 ? "heat" : ""}
    >
      <div className="sh-replica sh-replica--playground" inert>
        <MemosExploreReplica />
      </div>
      {PLAY_CURSORS.map((c) => (
        <PlayCursorSprite key={c.user.id} c={c} step={step} />
      ))}
      <div className="sh-play-presence">
        {PLAY_CURSORS.map(({ user: u }) => (
          <Picture key={u.id} base={u.photo} alt={u.name} />
        ))}
        <span>Live in the playground</span>
      </div>
    </div>
  );
}

function TrustSection() {
  return (
    <motion.section
      className="sh-section sh-section--trust"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      <div className="sh-copy sh-copy--section sh-copy--trust" style={{ position: "relative" }}>
        <motion.h3 className="sh-section-title" variants={rise}>
          {copy.bridge[0]}
          <br />
          {copy.bridge[1]}
        </motion.h3>
        <motion.p className="sh-p1" variants={rise}>
          {copy.trust}
        </motion.p>
      </div>

      <div className="sh-stage sh-stage--safe">
        <motion.div className="sh-window-wrap" variants={rise}>
          <WindowChrome>
            <PlaygroundStage />
          </WindowChrome>
        </motion.div>
      </div>
    </motion.section>
  );
}

function Final() {
  return (
    <motion.div
      className="sh-final"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      <motion.div className="sh-final__glyph" variants={rise}>
        <TerraMark />
      </motion.div>
      <h2>
        <motion.span variants={rise}>{copy.final[0]}</motion.span>
        <br />
        <motion.span variants={rise}>{copy.final[1]}</motion.span>
      </h2>
      <MotionLink
        to="/new"
        className="sh-btn"
        variants={rise}
        whileTap={{ scale: 0.98 }}
        style={{ margin: "24px 0 8px" }}
      >
        Map your repo <ArrowIcon />
      </MotionLink>
      <motion.div className="sh-footer-links" variants={rise}>
        <div>
          <a href="#">GitHub</a>
          <span>•</span>
          <a href="#">LinkedIn</a>
        </div>
        <div>
          <a href="#">Terms of service</a>
          <span>•</span>
          <a href="#">Privacy Policy</a>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** True while the star is docked in the Final glyph — the section observer
    stops steering it for as long as it is. */
let starDocked = false;
/** Ease-in-out on 0..1 — used to soften the scroll-driven section handoff. */
function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

/** Match `.sh-backdrop` cubic-bezier(0.22, 1, 0.36, 1) well enough for JS dock. */
function starDockEase(t: number) {
  return 1 - Math.pow(1 - t, 3.2);
}

/**
 * Last section: the travelling star shrinks onto the Final glyph and takes its
 * place. JS eases toward the live glyph for STAR_DOCK_MS (per-frame CSS
 * retargeting would lag then snap); after settle it sticks frame-exactly.
 */
function useStarFinalDock() {
  useEffect(() => {
    const star = document.querySelector<HTMLElement>(".sh-backdrop");
    const glyph = document.querySelector<HTMLElement>(".sh-final__glyph");
    if (!star || !glyph) return;

    let raf = 0;
    let dockStartedAt = 0;

    const setPose = (x: number, y: number, scale: number) => {
      star.style.setProperty("--sh-star-scale", `${scale}`);
      star.style.setProperty("--sh-star-x", `${x}px`);
      star.style.setProperty("--sh-star-y", `${y}px`);
    };

    /** Glyph centre relative to the untransformed star box (viewport coords). */
    const glyphTarget = () => {
      const g = glyph.getBoundingClientRect();
      const w = star.offsetWidth;
      const h = star.offsetHeight;
      if (!w || !h) return null;
      return {
        x: g.left + g.width / 2 - (star.offsetLeft + w / 2),
        y: g.top + g.height / 2 - (star.offsetTop + h / 2),
        scale: g.width / w,
      };
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting === starDocked) return;
        starDocked = entry.isIntersecting;
        glyph.classList.toggle("sh-final__glyph--handoff", starDocked);

        if (starDocked) {
          // JS-drive the dock so the target can scroll without a late snap.
          star.classList.add("sh-backdrop--docked");
          const from = star.getBoundingClientRect();
          const w = star.offsetWidth;
          const h = star.offsetHeight;
          if (!w || !h) return;
          const startX = from.left + from.width / 2 - (star.offsetLeft + w / 2);
          const startY = from.top + from.height / 2 - (star.offsetTop + h / 2);
          const startScale = from.width / w;
          dockStartedAt = performance.now();

          let trackedScrollY = -1;
          const track = () => {
            raf = requestAnimationFrame(track);
            const t = Math.min(
              1,
              (performance.now() - dockStartedAt) / STAR_DOCK_MS,
            );
            // Once settled the pose only changes when the glyph moves, i.e. on
            // scroll — otherwise this loop reflows every frame for nothing.
            if (t >= 1 && window.scrollY === trackedScrollY) return;
            trackedScrollY = window.scrollY;
            const target = glyphTarget();
            if (!target) return;
            if (t < 1) {
              const e = starDockEase(t);
              setPose(
                startX + (target.x - startX) * e,
                startY + (target.y - startY) * e,
                startScale + (target.scale - startScale) * e,
              );
            } else {
              setPose(target.x, target.y, target.scale);
            }
          };
          track();
          return;
        }
        cancelAnimationFrame(raf);
        raf = 0;
        star.classList.remove("sh-backdrop--docked");
        star.style.removeProperty("--sh-star-scale");
        // The section tracker owns the pose again from the next frame.
      },
      { threshold: 0.9 },
    );
    io.observe(glyph);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      starDocked = false;
    };
  }, []);
}

/**
 * The star stays off the page through the body sections: it only shows up for
 * the last stretch, gliding down from above into the final section, where the
 * dock below shrinks it onto the glyph. The whole approach is scrubbed by how
 * far the final section has climbed, so it reverses cleanly on scroll-up.
 */
function useStarFinalApproach() {
  useEffect(() => {
    const star = document.querySelector<HTMLElement>(".sh-backdrop");
    const final = document.querySelector<HTMLElement>(".sh-final");
    const glyph = document.querySelector<HTMLElement>(".sh-final__glyph");
    if (!star || !final || !glyph) return;

    let raf = 0;
    let lastScrollY = -1;
    let lastVh = -1;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      // The final dock drives the pose itself while it owns the star.
      if (starDocked) return;
      // Nothing scrolled → skip the layout reads. Idling here otherwise costs
      // a forced reflow every frame, forever.
      if (window.scrollY === lastScrollY && window.innerHeight === lastVh) return;
      lastScrollY = window.scrollY;
      lastVh = window.innerHeight;

      const vh = window.innerHeight;
      // 0 until the final section reaches the fold, 1 once it has climbed a
      // full viewport height — the star's whole descent rides that.
      const p = (vh - final.getBoundingClientRect().top) / vh;
      if (p <= 0) {
        star.classList.remove("sh-backdrop--revealed");
        star.style.removeProperty("--sh-star-x");
        star.style.removeProperty("--sh-star-y");
        return;
      }
      star.classList.add("sh-backdrop--revealed");

      // Land on the glyph's line; the dock takes it the rest of the way in.
      const g = glyph.getBoundingClientRect();
      const to = {
        x: g.left + g.width / 2 - (star.offsetLeft + star.offsetWidth / 2),
        y: g.top + g.height / 2 - (star.offsetTop + star.offsetHeight / 2),
      };
      const from = { x: to.x, y: to.y - vh * STAR_ENTRY_RISE_VH };
      const e = smoothstep(Math.min(1, p));
      star.style.setProperty("--sh-star-x", `${from.x + (to.x - from.x) * e}px`);
      star.style.setProperty("--sh-star-y", `${from.y + (to.y - from.y) * e}px`);
    };
    tick();

    return () => cancelAnimationFrame(raf);
  }, []);
}

/** Per-frame catch-up toward the wheel target — lower is smoother/slower, but
    every frame of catch-up repaints the page, so it also sets how long one
    flick keeps the GPU busy (0.04 ≈ 3s of repaints, 0.12 ≈ 0.6s). */
const SMOOTH_SCROLL_EASE = 0.12;
/** Wheel delta multiplier — under 1 so one flick covers less ground. */
const SMOOTH_SCROLL_GAIN = 0.24;
/** A "line" of wheel delta (deltaMode 1) in px. */
const WHEEL_LINE_PX = 16;

/** Can `el` (or an ancestor) still scroll `dy` itself? Then leave it alone —
    modals and code panes must keep their own native scrolling. */
function scrollableUnder(el: EventTarget | null, dy: number) {
  let node = el instanceof Element ? el : null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const scrolls = /auto|scroll|overlay/.test(style.overflowY);
    if (scrolls && node.scrollHeight > node.clientHeight) {
      const room = dy > 0
        ? node.scrollHeight - node.clientHeight - node.scrollTop
        : node.scrollTop;
      if (room > 1) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Wheel scrolling eased frame by frame, so the pinned hero scrubs like video
 * instead of snapping. Only wheel is intercepted — touch, keyboard, anchors and
 * the scrollbar keep their native behaviour (and resync the target).
 */
function useSmoothWheelScroll() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced !== false || !window.matchMedia("(pointer: fine)").matches) return;
    let target = window.scrollY;
    let raf = 0;
    let running = false;

    const maxY = () =>
      document.documentElement.scrollHeight - window.innerHeight;

    // Where we left the page last frame. If it moved without us — lazy images,
    // a section resizing, scroll anchoring — the target is stale by exactly
    // that much, and easing toward it would drag the reader back.
    let expected = -1;

    const tick = () => {
      if (expected >= 0) target += window.scrollY - expected;
      const diff = target - window.scrollY;
      if (Math.abs(diff) < 0.5) {
        window.scrollTo(0, target);
        expected = -1;
        running = false;
        return;
      }
      window.scrollTo(0, window.scrollY + diff * SMOOTH_SCROLL_EASE);
      expected = window.scrollY;
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      const raw = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
      const dy = raw * SMOOTH_SCROLL_GAIN;
      if (scrollableUnder(e.target, dy)) return;
      e.preventDefault();
      if (!running) target = window.scrollY;
      target = Math.min(maxY(), Math.max(0, target + dy));
      if (!running) {
        running = true;
        expected = -1;
        raf = requestAnimationFrame(tick);
      }
    };

    // Anything that scrolls us by other means owns the target from then on.
    const onScroll = () => {
      if (!running) target = window.scrollY;
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduced]);
}

export default function TerraLanding() {
  // No splash/loader — paint nav + hero immediately.
  // The theater opens inside whichever repo card was clicked, so each
  // RepoMapDiagram owns it — nothing to lift up here.
  useStarFinalApproach();
  useStarFinalDock();
  useSmoothWheelScroll();
  return (
    <MotionConfig reducedMotion="user">
      <div className="sh-root">
        <SiteNav />

        <Hero />
        <PowerSection />
        <TrustSection />
        <Final />
      </div>
    </MotionConfig>
  );
}
