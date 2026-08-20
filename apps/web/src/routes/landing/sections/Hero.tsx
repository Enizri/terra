import {
  animate,
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { rise, stagger } from "../../../shared/motion";
import { copy, users } from "../data";
import { ComponentTile, MacPointer, PENCIL_INK, WindowChrome } from "../primitives";
import { WsDropCard } from "../../../shared/shell/DropCard";
import { HeroScriptedDemo } from "./HeroDemo";

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
const FLIGHT_TILE_PX_FALLBACK = 128;

/** Shared graphite filter for trail and headline pencil marks. */
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

/** Where the trail points: top-center of the 720px video / drop frame. */
const TRAIL_END_Y = -160;

/** Sideways nudge on the trail's end so the arrow sits over the drop target. */
const TRAIL_END_X = 0;

/** Arrowhead at the trail's end — sketched open, like the line itself. */
const ARROW_D =
  `M ${TRAIL_END_X - 13} ${TRAIL_END_Y - 16}` +
  ` L ${TRAIL_END_X} ${TRAIL_END_Y}` +
  ` L ${TRAIL_END_X + 12} ${TRAIL_END_Y - 19}`;

/** Pencil trail from the right-parked GitHub card into the video / drop frame. */
function DragTrail({
  start,
  progress,
  tilePx,
}: {
  start: { x: number; y: number };
  progress: MotionValue<number>;
  tilePx: number;
}) {
  const reduced = useReducedMotion();
  // Right-side park → soft loop → long swoop into the video top-center.
  // Keep the doodle from going further right than the tile (card clips overflow).
  const sx = start.x;
  // Bottom-centre of the parked tile, then a short gap so the stroke
  // begins under the card rather than out of its middle.
  const sy = start.y + tilePx / 2 + 8;
  const midX = sx * 0.55;
  const midY = (sy + TRAIL_END_Y) * 0.55;
  const d =
    `M ${sx} ${sy}` +
    // Small hand-drawn loop under the tile — bias left so resize never clips it.
    ` C ${sx + 18} ${sy + 40}, ${sx - 8} ${sy + 108}, ${sx - 36} ${sy + 122}` +
    ` C ${sx - 68} ${sy + 138}, ${sx - 52} ${sy + 78}, ${sx - 10} ${sy + 96}` +
    // Long swoop left and down into the video frame.
    ` C ${sx + 36} ${sy + 150}, ${midX + 24} ${midY}, ${midX} ${midY + 40}` +
    ` C ${sx * 0.22} ${TRAIL_END_Y - 90}, ${TRAIL_END_X + 18} ${TRAIL_END_Y - 36}, ${TRAIL_END_X} ${TRAIL_END_Y}`;
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
        <path d={ARROW_D} {...stroke} strokeWidth={2.2} opacity={0.45} />
        {/* Pencil fills that guide in as the card is dragged, running ahead of it. */}
        <motion.path d={d} {...stroke} strokeWidth={6} opacity={0.24} style={{ pathLength: drawn }} />
        <motion.path d={d} {...stroke} strokeWidth={3.2} opacity={0.95} style={{ pathLength: drawn }} />
        {/* Hand-drawn arrowhead, sketched twice like a real pencil stroke. */}
        <motion.g style={{ opacity: arrowOpacity }}>
          <path d={ARROW_D} {...stroke} strokeWidth={3.2} />
          <path d={`M -10 ${TRAIL_END_Y - 20} L 1 ${TRAIL_END_Y - 3}`} {...stroke} strokeWidth={1.8} opacity={0.7} />
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

/** Headline rewrite: erase "engineers", write "humans". */
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
const LANDING_GAP_MIN = 96;
/** Expanded film height (mat included) — mirrors `.sh-hero-screen.is-expanded`
 *  plus the screen padding in playground.css. */
const HERO_SCREEN_EXPANDED_PX = 760;
/** Extra scroll while sticky after drop so the repo map can fully assemble. */
const HERO_HOLD_PX = 240;

/** Extra pinned scroll after the drag lands — the film sits centred and the
    scroll reads slow instead of running straight on into Power. */
const HERO_CENTER_HOLD_PX = 420;

/** How much sooner than the pin the drag finishes, px — the drop lands while
    the card is still arriving, so the slow pinned stretch starts on a card
    that is already fully dragged. */
const HERO_DRAG_LEAD_PX = 320;

/** Ease-out exponent on the drag: >1 slows the approach into the frame. */
const DRAG_EASE_POWER = 0.55;

/** Freeze drag geometry after this progress. */
const FLIGHT_LOCK_PROGRESS = 0.04;
/** Hysteresis for map↔drop swap at the threshold. */
const FLIGHT_UNDROP_PROGRESS = 0.9;

export function Hero() {
  const pinRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Invisible slot beside the headline — flight parks here at progress 0.
  const flightAnchorRef = useRef<HTMLDivElement>(null);
  const [filesDropped, setFilesDropped] = useState(false);
  const [heroHeight, setHeroHeight] = useState(0);
  // Scroll Y where the GitHub drag finishes (frame + slow sticky tail).
  const [dragEndScroll, setDragEndScroll] = useState(1);
  // Stage-centered start so the card sits next to the title, not a fixed guess.
  const [flightStart, setFlightStart] = useState({ x: 400, y: -420 });
  const [flightTilePx, setFlightTilePx] = useState(FLIGHT_TILE_PX_FALLBACK);
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
      // The painting stays directly below the nav on tall screens too.
      const gap = LANDING_GAP_MIN;
      // Base frame: painting sits at `gap` under the nav.
      const framedTop = gap - cardOffset;
      // Final pin: the expanded film centered in the viewport. Computed from
      // the fixed expanded height (not the live one) so the value is identical
      // before and after the drop — the hero never jumps when the film grows.
      const screen = card.querySelector<HTMLElement>(".sh-power-theater__screen");
      let stickTop = framedTop;
      if (screen) {
        const screenTopInHero =
          screen.getBoundingClientRect().top - hero.getBoundingClientRect().top;
        stickTop = Math.min(
          framedTop,
          Math.round((window.innerHeight - HERO_SCREEN_EXPANDED_PX) / 2 - screenTopInHero),
        );
      }
      hero.style.setProperty("--hero-stick-top", `${stickTop}px`);
      centerLiftRef.current = framedTop - stickTop;

      setHeroHeight(hero.offsetHeight);
      setCenterLift(centerLiftRef.current);

      // Sticky engages exactly where the drag ends: free scroll all the way
      // through the drag, then the pin takes over with the film centered.
      setDragEndScroll(Math.max(1, pin.offsetTop - stickTop - HERO_DRAG_LEAD_PX));

      // Mid-drag: keep stick metrics fresh, but don't rewrite the flight path.
      if (dragGeomLocked.current && !parked) return;

      // Park on the right-edge anchor; Y matches the title on desktop so the
      // tile sits at headline height instead of a vh guess that drifts.
      const anchor = flightAnchorRef.current;
      const title = hero.querySelector(".sh-hero-title");
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
        const titleRect = title?.getBoundingClientRect();
        const stageCx = sr.left + sr.width / 2;
        const stageCy = sr.top + sr.height / 2;
        const inset = tilePx / 2 - 16;
        const rawX = ar.left + ar.width / 2 - stageCx;
        const rawY =
          titleRect && window.innerWidth > 900
            ? titleRect.top + tilePx / 2 - stageCy
            : ar.top + ar.height / 2 - stageCy;
        const maxX = cr.right - inset - stageCx;
        const minX = Math.min(maxX, cr.left + inset - stageCx);
        setFlightStart({
          x: Math.round(Math.min(maxX, Math.max(minX, rawX))),
          y: Math.round(rawY),
        });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (heroRef.current) observer.observe(heroRef.current);
    if (cardRef.current) observer.observe(cardRef.current);
    if (stageRef.current) observer.observe(stageRef.current);
    if (flightAnchorRef.current) observer.observe(flightAnchorRef.current);
    const headEl = heroRef.current?.querySelector(".sh-hero-head");
    if (headEl) observer.observe(headEl);
    const titleEl = heroRef.current?.querySelector(".sh-hero-title");
    if (titleEl) observer.observe(titleEl);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
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
      ? heroHeight + HERO_HOLD_PX + HERO_CENTER_HOLD_PX + centerLift
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
        <LayoutGroup>
          {/* First screen: wallpaper, copy, and product share one card. */}
          <div className="sh-power-theater sh-hero-theater sh-hero-card" ref={cardRef}>
            <img
              className="sh-power-theater__wallpaper"
              src="/images/theater/power-wallpaper.jpg"
              alt=""
              aria-hidden
              draggable={false}
            />

            <div className="sh-copy sh-copy--hero">
              <div className="sh-hero-head">
                <HeroTitle />
                {/* Beside the headline — measured vs stage center for the drag. */}
                <div ref={flightAnchorRef} className="sh-flight-anchor" aria-hidden />
              </div>
              <motion.p className="sh-p1" variants={rise}>
                {copy.heroSubtitle}
              </motion.p>
            </div>

            <div className="sh-stage sh-stage--hero" ref={stageRef}>
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
                <DragTrail start={flightStart} progress={scrollYProgress} tilePx={flightTilePx} />
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
