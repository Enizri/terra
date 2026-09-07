import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rise, stagger } from "../../../shared/motion";
import { users } from "../data";
import { ComponentTile, MacPointer, PENCIL_INK, WindowChrome } from "../primitives";
import { WsDropCard } from "../../../shared/shell/DropCard";
import { HeroScriptedDemo } from "./HeroScriptedDemo";

/** Lerp follower for scroll-driven flight; RAF only while catching up. */
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

const HERO_FLIGHT_LERP = 0.15;

/** Hero flight tile fallback — actual size comes from `--sh-flight-tile`. */
const FLIGHT_TILE_PX_FALLBACK = 88;
/** Gap under the nav where the GitHub tile parks, px. */
const FLIGHT_PARK_NAV_GAP_PX = 8;
/** Nudge the parked tile inward from the right edge (smaller = further right). */
const FLIGHT_PARK_LEFT_PX = 0;

/** Shared graphite filter for the drag pencil trail. */
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

/** How far ahead of the card the pencil line runs, as a share of the path. */
const TRAIL_LEAD = 0.24;

/** Fill speed relative to the drag — >1 so the pencil pulls further ahead. */
const TRAIL_FILL_RATE = 0.95;

/** Where the trail points: top-center of the drop frame (stage-centered). */
const TRAIL_END_Y_FALLBACK = -160;

/** Sideways nudge on the trail's end so the arrow sits over the drop target. */
const TRAIL_END_X = 0;

/** Pencil trail from the right-parked GitHub card into the video / drop frame. */
function DragTrail({
  start,
  progress,
  tilePx,
  endY,
}: {
  start: { x: number; y: number };
  progress: MotionValue<number>;
  tilePx: number;
  endY: number;
}) {
  const reduced = useReducedMotion();
  // Right-side park → soft loop → long swoop into the video top-center.
  // Keep the doodle from going further right than the tile (card clips overflow).
  const sx = start.x;
  // Bottom-centre of the parked tile, then a short gap so the stroke
  // begins under the card rather than out of its middle.
  const sy = start.y + tilePx / 2 + 8;
  const ey = endY;
  const midX = sx * 0.55;
  const midY = (sy + ey) * 0.55;
  const arrowD =
    `M ${TRAIL_END_X - 13} ${ey - 16}` +
    ` L ${TRAIL_END_X} ${ey}` +
    ` L ${TRAIL_END_X + 12} ${ey - 19}`;
  const d =
    `M ${sx} ${sy}` +
    // Compact hand-drawn loop under the smaller tile — bias left so resize never clips it.
    ` C ${sx + 14} ${sy + 28}, ${sx - 6} ${sy + 76}, ${sx - 26} ${sy + 86}` +
    ` C ${sx - 48} ${sy + 98}, ${sx - 38} ${sy + 54}, ${sx - 8} ${sy + 68}` +
    // Long swoop left and down into the video frame.
    ` C ${sx + 24} ${sy + 108}, ${midX + 24} ${midY}, ${midX} ${midY + 28}` +
    ` C ${sx * 0.22} ${ey - 90}, ${TRAIL_END_X + 18} ${ey - 36}, ${TRAIL_END_X} ${ey}`;
  // The line draws itself as the card travels, staying TRAIL_LEAD ahead so it
  // reads as leading the card in rather than trailing behind it.
  const drawn = useTransform(progress, (p) =>
    reduced ? 1 : Math.min(1, TRAIL_LEAD + p * TRAIL_FILL_RATE),
  );
  // Only clears once the card has landed — until then it is the route.
  const opacity = useTransform(progress, [0, 0.88, 1], [1, 1, 0]);
  // Arrow lands when the pencil reaches the window, not before.
  const arrowOpacity = useTransform(drawn, [0.9, 1], [0, 0.9]);
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
        <path d={d} {...stroke} strokeWidth={2.2} opacity={0.45} />
        <path d={arrowD} {...stroke} strokeWidth={2.2} opacity={0.45} />
        {/* Pencil fills that guide in as the card is dragged, running ahead of it. */}
        <motion.path d={d} {...stroke} strokeWidth={6} opacity={0.24} style={{ pathLength: drawn }} />
        <motion.path d={d} {...stroke} strokeWidth={3.2} opacity={0.95} style={{ pathLength: drawn }} />
        {/* Hand-drawn arrowhead, sketched twice like a real pencil stroke. */}
        <motion.g style={{ opacity: arrowOpacity }}>
          <path d={arrowD} {...stroke} strokeWidth={3.2} />
          <path d={`M -10 ${ey - 20} L 1 ${ey - 3}`} {...stroke} strokeWidth={1.8} opacity={0.7} />
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

/** Min top clearance when the framed card is taller than the viewport. */
const LANDING_GAP_MIN = 96;
/** Pre-drop drop-window mat — `.sh-hero-theater .sh-power-theater__screen`. */
const HERO_SCREEN_PREDROP_PX = 412;
/** Bias the pre-drop screen below vertical center, px. */
const HERO_SCREEN_LOWER_PX = 110;
/** Extra scroll while sticky after drop so the repo map can fully assemble. */
const HERO_HOLD_PX = 400;

/** Extra pinned scroll after the drag lands — the film sits centred and the
    scroll reads slow instead of running straight on into Power. */
const HERO_CENTER_HOLD_PX = 720;

/** GitHub flight after the drop window is locked in the middle, px. */
const HERO_DRAG_WHILE_PINNED_PX = 640;

/** Ease-out exponent on the drag: >1 slows the approach into the frame. */
const DRAG_EASE_POWER = 0.55;

/** Freeze drag geometry after this progress. */
const FLIGHT_LOCK_PROGRESS = 0.04;
/** Hysteresis for map↔drop swap at the threshold. */
const FLIGHT_UNDROP_PROGRESS = 0.9;

/** Offset of `el` inside `ancestor` via offsetParent (ignores sticky transforms). */
function offsetTopIn(el: HTMLElement, ancestor: HTMLElement) {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === ancestor ? y : el.offsetTop;
}

export function Hero() {
  const pinRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Invisible slot on the stage — flight X parks from here at progress 0.
  const flightAnchorRef = useRef<HTMLDivElement>(null);
  const [filesDropped, setFilesDropped] = useState(false);
  const [heroHeight, setHeroHeight] = useState(0);
  // Scroll Y where the GitHub drag finishes (frame + slow sticky tail).
  const [dragEndScroll, setDragEndScroll] = useState(1);
  // Stage-centered start so the GitHub tile parks under the nav on the right.
  const [flightStart, setFlightStart] = useState({ x: 400, y: -420 });
  const [flightTilePx, setFlightTilePx] = useState(FLIGHT_TILE_PX_FALLBACK);
  // Stage-centered Y where the pencil arrow meets the drop window top.
  const [trailEndY, setTrailEndY] = useState(TRAIL_END_Y_FALLBACK);
  // Once the drag is underway, ignore layout remeasures — the park anchor
  // leaves the viewport and would rewrite the trajectory every frame.
  const dragGeomLocked = useRef(false);
  // Extra scroll the post-drop re-centering consumes; the pin grows by it so
  // the hold after the drop is not eaten by the lift.
  const centerLiftRef = useRef(0);
  const [centerLift, setCenterLift] = useState(0);
  // Sticky pin (not fixed/absolute swaps): native scroll blends through
  // free → framed → hold → release with no JS position thrashing.
  const { scrollY } = useScroll();
  const scrollRaw = useTransform(scrollY, [0, dragEndScroll], [0, 1]);
  // Ease-out: the card covers most of the route early, then crawls the last
  // stretch into the frame — the drag reads slow where it is being watched.
  const scrollYProgress = useTransform(scrollRaw, (p) =>
    p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.pow(1 - p, DRAG_EASE_POWER),
  );
  const progressRef = useRef(scrollYProgress);
  progressRef.current = scrollYProgress;

  useLayoutEffect(() => {
    const measure = () => {
      const pin = pinRef.current;
      const hero = heroRef.current;
      const card = cardRef.current;
      const stage = stageRef.current;
      if (!pin || !hero || !card || !stage) return;

      const progress = progressRef.current.get();
      const parked = progress < FLIGHT_LOCK_PROGRESS;
      // At the park (or after a resize that snapped us back), unlock so the
      // GitHub tile + pencil trail reflow with the painting instead of
      // vanishing off the right edge with a stale offset.
      if (parked) dragGeomLocked.current = false;

      const cardOffset = card.offsetTop;
      // Rest layout keeps the painting under the nav; the pin may lift above
      // that so the drop window can sit in the middle, but it must not push
      // the painting *down* on a short screen.
      const framedTop = LANDING_GAP_MIN - cardOffset;
      // Pin so the *pre-drop* drop window sits in the middle of the viewport.
      // The expanded film is taller; centering that box pulled the small card
      // up into the nav and made the stick wait on the clip. Offset within
      // the card (not the sticky hero) so a height change cannot chase itself.
      const screen = card.querySelector<HTMLElement>(".sh-power-theater__screen");
      let stickTop = framedTop;
      if (screen) {
        const screenTopInHero = offsetTopIn(screen, hero);
        // Bias below vertical center so the drop card sits lower in the
        // viewport. Still respect the nav clearance floor.
        stickTop = Math.max(
          framedTop,
          Math.round(
            (window.innerHeight - HERO_SCREEN_PREDROP_PX) / 2 +
              HERO_SCREEN_LOWER_PX -
              screenTopInHero,
          ),
        );
      }
      if (parked) {
        hero.style.setProperty("--hero-stick-top", `${stickTop}px`);
        // `hero.offsetTop` grows once sticky (it reports the in-flow box inside
        // the pin). The hero is the pin's first child, so rest offset is 0.
        const stickDistance = Math.max(0, Math.round(pin.offsetTop - stickTop));
        centerLiftRef.current = stickDistance;
        setHeroHeight(hero.offsetHeight);
        setCenterLift(stickDistance);
        // Stick first (inner card locked in the middle), then keep dragging.
        setDragEndScroll(stickDistance + HERO_DRAG_WHILE_PINNED_PX);
      }

      // Mid-drag: keep stick metrics fresh, but don't rewrite the flight path.
      if (dragGeomLocked.current && !parked) return;

      // Park under the nav on the right; pencil trail swoops down into the
      // drop window from there.
      const anchor = flightAnchorRef.current;
      const tilePx = Math.round(
        anchor?.offsetWidth ||
          hero.querySelector(".sh-tile--flight")?.getBoundingClientRect().width ||
          FLIGHT_TILE_PX_FALLBACK,
      );
      setFlightTilePx(tilePx);
      if (anchor) {
        const ar = anchor.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const nav = document.querySelector(".sh-nav");
        const navBottom = nav?.getBoundingClientRect().bottom ?? 96;
        const stageCx = sr.left + sr.width / 2;
        const stageCy = sr.top + sr.height / 2;
        const inset = tilePx / 2 - 28;
        const rawX = ar.left + ar.width / 2 - stageCx;
        const rawY =
          window.innerWidth > 900
            ? navBottom + FLIGHT_PARK_NAV_GAP_PX + tilePx / 2 - stageCy
            : ar.top + ar.height / 2 - stageCy;
        const maxX = cr.right - inset - stageCx;
        const minX = Math.min(maxX, cr.left + inset - stageCx);
        setFlightStart({
          x: Math.round(Math.min(maxX, Math.max(minX, rawX)) - FLIGHT_PARK_LEFT_PX),
          y: Math.round(rawY),
        });
        if (screen) {
          const screenRect = screen.getBoundingClientRect();
          setTrailEndY(Math.round(screenRect.top - stageCy));
        }
      }
    };
    measure();
    const raf = requestAnimationFrame(() => {
      measure();
      requestAnimationFrame(measure);
    });
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (heroRef.current) observer.observe(heroRef.current);
    if (cardRef.current) observer.observe(cardRef.current);
    if (stageRef.current) observer.observe(stageRef.current);
    if (flightAnchorRef.current) observer.observe(flightAnchorRef.current);
    const screenEl = cardRef.current?.querySelector(".sh-power-theater__screen");
    if (screenEl) observer.observe(screenEl);
    window.addEventListener("resize", measure);
    const late = window.setTimeout(measure, 0);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.clearTimeout(late);
    };
  }, []);

  // Continuous scrub — no phase cuts in the progress curve.
  // (scrollYProgress declared above so measure() can read it on resize.)

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
      ? heroHeight +
        centerLift +
        HERO_DRAG_WHILE_PINNED_PX +
        HERO_HOLD_PX +
        HERO_CENTER_HOLD_PX
      : undefined;

  return (
    <div ref={pinRef} id="top" className="sh-hero-pin" style={{ height: pinHeight }}>
      <motion.section
        ref={heroRef}
        className="sh-section sh-section--hero"
        data-dropped={filesDropped ? "1" : "0"}
        initial="hidden"
        animate="show"
        variants={stagger}
      >
        <LayoutGroup>
          {/* First screen: drop window + GitHub flight tile. */}
          <div className="sh-power-theater sh-hero-theater sh-hero-card" ref={cardRef}>
            <PencilDefs />
            <div className="sh-stage sh-stage--hero" ref={stageRef}>
              {/* Park slot for the GitHub flight — measured vs stage center. */}
              <div ref={flightAnchorRef} className="sh-flight-anchor" aria-hidden />
              <motion.div className="sh-window-wrap" variants={rise}>
                <div className="sh-power-theater__screen">
                  {/* Small static drop window pre-drop; the box expands into
                      the full workspace film once the GitHub card lands. */}
                  <div className={`sh-hero-screen${filesDropped ? " is-expanded" : ""}`}>
                    <WindowChrome toolbar={false}>
                      <div className="sh-window-body">
                        {filesDropped ? (
                          <HeroScriptedDemo dropped={filesDropped} />
                        ) : (
                          <div className="sh-hero-mini">
                            <WsDropCard />
                          </div>
                        )}
                      </div>
                    </WindowChrome>
                  </div>
                </div>
              </motion.div>

              {/* One right-side flight card flies with the scroll and fades out
                  the moment the drop lands and the window starts expanding. */}
              {!filesDropped && (
                <DragTrail
                  start={flightStart}
                  progress={scrollYProgress}
                  tilePx={flightTilePx}
                  endY={trailEndY}
                />
              )}

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
          </div>
        </LayoutGroup>
      </motion.section>
    </div>
  );
}

/* ---------- sections ---------- */
