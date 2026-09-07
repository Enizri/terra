import { useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import {
  createCelestialGlobeRenderer,
  type CelestialGlobeRenderer,
} from "../celestialGlobe3D";
import {
  advanceSpin,
  createSpin,
  dragBy,
  grab,
  release,
} from "../globeDrag";
import {
  advanceToss,
  createToss,
  grabToss,
  releaseToss,
  tossBy,
  tossYawGain,
} from "../globeToss";
import {
  cleanGlobeJourneyOpacity,
  cleanGlobeJourneyProgress,
  cleanGlobeJourneyScale,
  clipRectToViewport,
  FINALE_HAZE_SPREAD,
  FINALE_SUN_BLUR_RADIUS,
  finaleGlobeFit,
  smoothGlobeJourneyProgress,
} from "../globeLayout";

/** Matches `.terra-finale__floor` so the clip and the card share a corner. */
const FINALE_RADIUS = 24;
/** Easing leftover smaller than this is a still frame — park the loop. */
const SETTLE = 0.0008;

/** Skip writes that would only dirty a filtered/masked compositor layer. */
function setCss(el: HTMLElement | null, prop: string, value: string) {
  if (!el) return;
  if (el.style.getPropertyValue(prop) === value) return;
  if (value) el.style.setProperty(prop, value);
  else el.style.removeProperty(prop);
}

function setDim(
  el: HTMLElement | null,
  prop: "width" | "height" | "opacity" | "transform" | "objectPosition",
  value: string,
) {
  if (!el) return;
  if (el.style[prop] === value) return;
  el.style[prop] = value;
}

/** The closing globe renders only inside the footer artwork. */
export function GlobeJourney({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = Boolean(reduced);
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const pad = grabRef.current;
    if (!root || !canvas || !pad) return;
    let sphereRenderer: CelestialGlobeRenderer | null = null;
    const dock = root.querySelector<HTMLElement>(".gx-journey__footer-dock");
    const glow = root.querySelector<HTMLElement>(".terra-finale__glow");
    const sun = root.querySelector<HTMLElement>(".terra-finale__sun");
    const fore = root.querySelector<HTMLElement>(".terra-finale__fore");
    const haze = root.querySelector<HTMLElement>(".terra-finale__haze");
    const skies = root.querySelectorAll<HTMLElement>(".terra-finale__sky");

    let disposed = false;
    let frame = 0;
    let visible = true;
    let width = 0;
    let height = 0;
    let last = 0;
    let shownCleanProgress = 0;
    const spin = createSpin();
    const toss = createToss();
    let dragging = false;
    let spinning = false;
    let tossing = false;
    /** True while the globe is parked on the sun, where a press throws it
     *  instead of only turning it. Latched at pointerdown so a scroll
     *  mid-gesture cannot change what the drag means. */
    let tossable = false;
    let tossHeld = false;
    let lastDragX = 0;
    let lastDragY = 0;
    let lastDragT = 0;
    let grabRadius = 1;
    let grabCenterX = 0;
    let grabCenterY = 0;

    const draw = (dt: number) => {
      if (disposed || width <= 0 || height <= 0) return false;
      const rootRect = root.getBoundingClientRect();
      if (rootRect.bottom < 0 || rootRect.top > height) return false;
      if (!dock) return false;

      const canvasRect = canvas.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const targetCleanProgress = cleanGlobeJourneyProgress(dockRect.top, height);
      shownCleanProgress = reduceMotion
        ? targetCleanProgress
        : smoothGlobeJourneyProgress(
          shownCleanProgress,
          targetCleanProgress,
          dt,
        );
      spinning = advanceSpin(spin, dt, dragging);
      const yaw = spin.yaw + 0.42;
      const pitch = spin.pitch - 0.08;
      const fit = finaleGlobeFit(dockRect, canvasRect);
      const cleanOpacity = cleanGlobeJourneyOpacity(shownCleanProgress);
      const cleanDiameter = fit.diameter * cleanGlobeJourneyScale(shownCleanProgress);
      const cleanActive = cleanOpacity > 0.001;
      // The finale chrome lets a press reach the globe through the artwork.
      const finaleGrab = cleanActive && cleanOpacity > 0.35;
      tossable = finaleGrab;
      // The box a thrown globe flies in: the rounded inner edge of the sky
      // card on three sides, and the terrace as the floor — below that ridge
      // the photo paints over it, so it would sink out of the scene.
      const tossRadius = cleanDiameter / 2;
      const cardLeft = dockRect.left - canvasRect.left;
      const cardTop = dockRect.top - canvasRect.top;
      const wall = FINALE_RADIUS + tossRadius;
      tossing = advanceToss(toss, dt, tossHeld, {
        left: cardLeft + wall - fit.x,
        right: cardLeft + dockRect.width - wall - fit.x,
        top: cardTop + wall - fit.y,
        bottom: cardTop + fit.ridge - tossRadius - fit.y,
      });
      // Parked on the painted sun from the first frame — the blur is the
      // backdrop, not a disc the globe has to climb onto — plus wherever the
      // reader has thrown it.
      const cleanX = fit.x + toss.x;
      const cleanY = fit.y + toss.y;
      const sticky = canvas.parentElement;
      setDim(sticky, "opacity", cleanActive ? "1" : "0");
      sticky?.classList.toggle("is-clean-flight", cleanActive);
      setCss(
        sticky,
        "clip-path",
        cleanActive ? clipRectToViewport(dockRect, canvasRect, FINALE_RADIUS) : "",
      );
      // The photo's crop is solved in one place and handed to both copies of
      // the <img>, so the picture and the globe can never drift apart.
      const focus = `${(fit.focusX * 100).toFixed(3)}% ${(fit.focusY * 100).toFixed(3)}%`;
      for (const sky of skies) setDim(sky, "objectPosition", focus);
      setCss(fore, "--fore-cut", `${fit.ridge}px`);
      setCss(fore, "--fore-fade", `${fit.ridgeFade}px`);
      setCss(
        haze,
        "--gx",
        `${cleanX + canvasRect.left - dockRect.left}px`,
      );
      setCss(
        haze,
        "--gy",
        `${cleanY + canvasRect.top - dockRect.top}px`,
      );
      setCss(haze, "--gd", `${cleanDiameter * FINALE_HAZE_SPREAD}px`);
      setDim(haze, "opacity", String(cleanActive ? cleanOpacity : 0));
      // Stay on the painted sun: the disc is the out-of-focus backdrop
      // sitting behind the mesh. `is-lit` is what arms the 72px blur.
      const sunX = fit.x + canvasRect.left - dockRect.left;
      const sunY = fit.y + canvasRect.top - dockRect.top;
      setCss(sun, "--sun-x", `${sunX}px`);
      setCss(sun, "--sun-y", `${sunY}px`);
      setCss(sun, "--sun-r", `${fit.diameter * FINALE_SUN_BLUR_RADIUS}px`);
      setDim(sun, "opacity", String(cleanActive ? cleanOpacity : 0));
      sun?.classList.toggle("is-lit", cleanActive);
      // The sky is lit by the sphere, so the spill tracks it when it moves.
      setDim(glow, "width", `${cleanDiameter * 2.6}px`);
      setDim(glow, "height", `${cleanDiameter * 2.6}px`);
      setDim(glow, "opacity", String(cleanActive ? cleanOpacity : 0));
      setDim(
        glow,
        "transform",
        `translate3d(${
          cleanX + canvasRect.left - dockRect.left - cleanDiameter * 1.3
        }px, ${cleanY + canvasRect.top - dockRect.top - cleanDiameter * 1.3}px, 0)`,
      );
      sphereRenderer?.render({
        width,
        height,
        diameter: cleanDiameter,
        x: cleanX,
        y: cleanY,
        yaw,
        // A ground-level view of a sphere hung high in the sky: the reader is
        // looking slightly up at it, like the figures on the terrace.
        pitch: pitch + 0.12,
        // Docked, the roll is the tumble the throw put on it.
        spin: reduceMotion ? 0.35 : 0.22 + toss.roll,
        opacity: cleanActive ? cleanOpacity : 0,
        hallLight: cleanActive ? 2.6 * cleanOpacity : 0,
      });

      // Remember the centre so a press can distinguish a rim grab.
      if (finaleGrab) {
        grabRadius = cleanDiameter / 2;
        grabCenterX = canvasRect.left + cleanX;
        grabCenterY = canvasRect.top + cleanY;
        setDim(pad, "width", `${cleanDiameter}px`);
        setDim(pad, "height", `${cleanDiameter}px`);
        setDim(
          pad,
          "transform",
          `translate3d(${cleanX - cleanDiameter / 2}px, ${cleanY - cleanDiameter / 2}px, 0)`,
        );
      }
      pad.classList.toggle("is-grabbable", finaleGrab);
      // A still docked globe is a still frame. Sitting on the FAQ used to
      // keep this loop at display rate, so every pointer composite
      // re-blended the flight. Scroll, drag, and an unfinished ease wake it.
      const easing =
        Math.abs(shownCleanProgress - targetCleanProgress) > SETTLE;
      return dragging || spinning || tossing || easing;
    };

    const tick = (now: number) => {
      frame = 0;
      if (disposed || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const animate = draw(dt);
      if (!reduceMotion && animate) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      if (disposed || document.hidden) return;
      if (frame) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width <= 0 || height <= 0) return;
      sphereRenderer?.resize(width, height, window.devicePixelRatio || 1);
      play();
    };
    const onDown = (event: PointerEvent) => {
      dragging = true;
      grab(spin);
      // A press on the footer globe can turn or throw it.
      tossHeld = tossable;
      if (tossHeld) {
        grabToss(
          toss,
          event.clientX - grabCenterX,
          event.clientY - grabCenterY,
          grabRadius,
        );
      }
      lastDragX = event.clientX;
      lastDragY = event.clientY;
      lastDragT = event.timeStamp;
      pad.setPointerCapture(event.pointerId);
      pad.classList.add("is-dragging");
      play();
    };
    const onDrag = (event: PointerEvent) => {
      if (!dragging) return;
      const dt = Math.max(0.001, (event.timeStamp - lastDragT) / 1000);
      const dx = event.clientX - lastDragX;
      const dy = event.clientY - lastDragY;
      if (tossHeld) tossBy(toss, dx, dy, dt);
      // A rim grab spends most of the gesture on roll, so it turns less.
      dragBy(spin, dx, dy, grabRadius, dt, tossHeld ? tossYawGain(toss) : 1);
      lastDragX = event.clientX;
      lastDragY = event.clientY;
      lastDragT = event.timeStamp;
      play();
    };
    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      release(spin);
      if (tossHeld) {
        releaseToss(toss);
        tossHeld = false;
      }
      if (pad.hasPointerCapture(event.pointerId)) {
        pad.releasePointerCapture(event.pointerId);
      }
      pad.classList.remove("is-dragging");
      play();
    };

    void createCelestialGlobeRenderer(canvas, play).then((created) => {
      if (disposed) {
        created?.dispose();
        return;
      }
      sphereRenderer = created;
      resize();
    });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) play();
      else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    intersectionObserver.observe(canvas);
    const onVisibility = () => {
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else play();
    };
    // Coarse pointers keep the globe inert so a swipe over it still scrolls.
    const grabbable =
      !reduceMotion && window.matchMedia("(pointer: fine)").matches;
    window.addEventListener("scroll", play, { passive: true });
    window.addEventListener("resize", resize);
    if (grabbable) {
      pad.addEventListener("pointerdown", onDown);
      pad.addEventListener("pointermove", onDrag);
      pad.addEventListener("pointerup", onUp);
      pad.addEventListener("pointercancel", onUp);
    }
    document.addEventListener("visibilitychange", onVisibility);
    resize();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("scroll", play);
      window.removeEventListener("resize", resize);
      if (grabbable) {
        pad.removeEventListener("pointerdown", onDown);
        pad.removeEventListener("pointermove", onDrag);
        pad.removeEventListener("pointerup", onUp);
        pad.removeEventListener("pointercancel", onUp);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      sphereRenderer?.dispose();
      canvas.parentElement?.style.removeProperty("clip-path");
    };
  }, [reduced]);

  return (
    <div ref={rootRef} className="gx-journey">
      <div className="gx-journey__sticky" aria-hidden>
        <canvas ref={canvasRef} className="gx-journey__sphere" />
        <div ref={grabRef} className="gx-journey__grab" />
      </div>
      {children}
    </div>
  );
}
