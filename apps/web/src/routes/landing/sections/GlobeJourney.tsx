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
  spinChurn,
} from "../globeDrag";
import { createGlobeRenderer } from "../globeGL";
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
  globeJourneyClockRate,
  globeJourneyInk,
  globeJourneyProgress,
  globeJourneyTravel,
  layoutGlobeJourney,
  smoothGlobeJourneyProgress,
} from "../globeLayout";

const MAP_FILL = 0.72;
/** Past this the globe is flying into the screen and stops being a handle. */
const GRAB_UNTIL = 0.03;
/** Matches `.terra-finale__floor` so the clip and the card share a corner. */
const FINALE_RADIUS = 24;

/** One canvas owns the globe from the hero through its entry into the screen. */
export function GlobeJourney({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sphereCanvasRef = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = Boolean(reduced);
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const sphereCanvas = sphereCanvasRef.current;
    const backdrop = backdropRef.current;
    const pad = grabRef.current;
    if (!root || !canvas || !sphereCanvas || !backdrop || !pad) return;
    const renderer = createGlobeRenderer(canvas);
    if (!renderer || renderer === "lost") return;
    let sphereRenderer: CelestialGlobeRenderer | null = null;

    let disposed = false;
    let frame = 0;
    let visible = true;
    let width = 0;
    let height = 0;
    let last = 0;
    let globeT = 0;
    let cleanT = 0;
    let shownProgress = 0;
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
      if (disposed || width <= 0 || height <= 0) return 1;
      const rootRect = root.getBoundingClientRect();
      if (rootRect.bottom < 0 || rootRect.top > height) return 1;
      const screen = root.querySelector<HTMLElement>(
        ".sh-power-theater__screen .sh-window",
      );
      const dock = root.querySelector<HTMLElement>(".gx-journey__footer-dock");
      const glow = root.querySelector<HTMLElement>(".terra-finale__glow");
      const sun = root.querySelector<HTMLElement>(".terra-finale__sun");
      const fore = root.querySelector<HTMLElement>(".terra-finale__fore");
      const haze = root.querySelector<HTMLElement>(".terra-finale__haze");
      if (!screen || !dock) return 1;

      const canvasRect = canvas.getBoundingClientRect();
      const screenRect = screen.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const targetProgress = reduceMotion
        ? 0
        : globeJourneyProgress(window.scrollY, screenRect.top, height);
      shownProgress = smoothGlobeJourneyProgress(shownProgress, targetProgress, dt);
      const progress = shownProgress;
      const targetCleanProgress = cleanGlobeJourneyProgress(dockRect.top, height);
      shownCleanProgress = reduceMotion
        ? targetCleanProgress
        : smoothGlobeJourneyProgress(
          shownCleanProgress,
          targetCleanProgress,
          dt,
        );
      if (!reduceMotion) globeT += dt * globeJourneyClockRate(progress);
      const desktop = width > 900;
      const size = desktop
        ? Math.min(width * 0.48, height * 0.82)
        : Math.min(width * 0.9, height * 0.58);
      const startX = desktop ? width * 0.75 : width * 0.5;
      // On phones the original globe owns the second hero row, below the copy.
      // Keep its centre below the first fold so it cannot cover either CTA.
      const startY = desktop ? height * 0.46 : height + size * 0.08;
      const targetX = screenRect.left + screenRect.width / 2 - canvasRect.left;
      const targetY = Math.min(height - 8, screenRect.top + 14 - canvasRect.top);
      spinning = advanceSpin(spin, dt, dragging);
      const yaw = spin.yaw + progress * 0.42;
      const pitch = spin.pitch + progress * -0.08;

      const glyphs = layoutGlobeJourney(
        {
          size,
          width,
          height,
          t: globeT,
          churnRate: spinChurn(spin),
          yaw,
          pitch,
          reduced: reduceMotion,
          progress,
          startX,
          startY,
          targetX,
          targetY,
        },
        renderer.data,
      );
      renderer.render({ glyphs });

      const travel = globeJourneyTravel(progress);
      const centerX = startX + (targetX - startX) * travel;
      const centerY = startY + (targetY - startY) * travel;
      const discFade = 1 - globeJourneyInk(progress);
      backdrop.style.width = `${size}px`;
      backdrop.style.height = `${size}px`;
      backdrop.style.opacity = String(discFade);
      backdrop.style.transform = `translate3d(${centerX - size / 2}px, ${centerY - size / 2}px, 0)`;
      if (!reduceMotion && shownCleanProgress > 0 && !dragging) cleanT += dt;
      const fit = finaleGlobeFit(dockRect, canvasRect);
      const cleanOpacity = cleanGlobeJourneyOpacity(shownCleanProgress);
      const cleanDiameter = fit.diameter * cleanGlobeJourneyScale(shownCleanProgress);
      const cleanActive = cleanOpacity > 0.001;
      // Same press-and-spin handle as the hero: it rides whichever globe is
      // on screen. The finale chrome is pointer-events none except its links,
      // so the press reaches this disc instead of the photo.
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
      const sticky = sphereCanvas.parentElement;
      sticky?.classList.toggle("is-clean-flight", cleanActive);
      if (sticky) {
        sticky.style.setProperty(
          "clip-path",
          cleanActive ? clipRectToViewport(dockRect, canvasRect, FINALE_RADIUS) : "",
        );
      }
      // The photo's crop is solved in one place and handed to both copies of
      // the <img>, so the picture and the globe can never drift apart.
      const focus = `${(fit.focusX * 100).toFixed(3)}% ${(fit.focusY * 100).toFixed(3)}%`;
      for (const sky of root.querySelectorAll<HTMLElement>(".terra-finale__sky")) {
        sky.style.objectPosition = focus;
      }
      if (fore) {
        fore.style.setProperty("--fore-cut", `${fit.ridge}px`);
        fore.style.setProperty("--fore-fade", `${fit.ridgeFade}px`);
      }
      if (haze) {
        haze.style.setProperty(
          "--gx",
          `${cleanX + canvasRect.left - dockRect.left}px`,
        );
        haze.style.setProperty(
          "--gy",
          `${cleanY + canvasRect.top - dockRect.top}px`,
        );
        haze.style.setProperty("--gd", `${cleanDiameter * FINALE_HAZE_SPREAD}px`);
        haze.style.opacity = String(cleanActive ? cleanOpacity : 0);
      }
      if (sun) {
        // Stay on the painted sun: the disc is the out-of-focus backdrop
        // sitting behind the mesh.
        const sunX = fit.x + canvasRect.left - dockRect.left;
        const sunY = fit.y + canvasRect.top - dockRect.top;
        sun.style.setProperty("--sun-x", `${sunX}px`);
        sun.style.setProperty("--sun-y", `${sunY}px`);
        sun.style.setProperty(
          "--sun-r",
          `${fit.diameter * FINALE_SUN_BLUR_RADIUS}px`,
        );
        sun.style.opacity = String(cleanActive ? cleanOpacity : 0);
      }
      if (glow) {
        // The sky is lit by the sphere, so the spill tracks it frame by frame.
        glow.style.width = `${cleanDiameter * 2.6}px`;
        glow.style.height = `${cleanDiameter * 2.6}px`;
        glow.style.opacity = String(cleanActive ? cleanOpacity : 0);
        glow.style.transform = `translate3d(${
          cleanX + canvasRect.left - dockRect.left - cleanDiameter * 1.3
        }px, ${cleanY + canvasRect.top - dockRect.top - cleanDiameter * 1.3}px, 0)`;
      }
      sphereRenderer?.render({
        width,
        height,
        diameter: cleanActive ? cleanDiameter : size * MAP_FILL,
        x: cleanActive ? cleanX : centerX,
        y: cleanActive ? cleanY : centerY,
        yaw,
        // A ground-level view of a sphere hung high in the sky: the reader is
        // looking slightly up at it, like the figures on the terrace.
        pitch: cleanActive ? pitch + 0.12 : pitch,
        // Docked, the roll is the tumble the throw put on it.
        spin: reduceMotion
          ? 0.35
          : cleanActive
          ? 0.22 + toss.roll
          : globeT * 0.22 + cleanT * 0.18,
        opacity: cleanActive ? cleanOpacity : discFade,
        hallLight: cleanActive ? 2.6 * cleanOpacity : 0,
      });

      // The handle rides whichever globe is on screen, and remembers where
      // its centre landed so a press can tell a rim grab from a centre one.
      if (finaleGrab) {
        grabRadius = cleanDiameter / 2;
        grabCenterX = canvasRect.left + cleanX;
        grabCenterY = canvasRect.top + cleanY;
        pad.style.width = `${cleanDiameter}px`;
        pad.style.height = `${cleanDiameter}px`;
        pad.style.transform =
          `translate3d(${cleanX - cleanDiameter / 2}px, ${cleanY - cleanDiameter / 2}px, 0)`;
      } else {
        grabRadius = size / 2;
        grabCenterX = canvasRect.left + centerX;
        grabCenterY = canvasRect.top + centerY;
        pad.style.width = `${size}px`;
        pad.style.height = `${size}px`;
        pad.style.transform =
          `translate3d(${centerX - size / 2}px, ${centerY - size / 2}px, 0)`;
      }
      pad.classList.toggle("is-grabbable", finaleGrab || progress < GRAB_UNTIL);
      return Math.min(progress, shownCleanProgress);
    };

    const tick = (now: number) => {
      frame = 0;
      if (disposed || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const progress = draw(dt);
      const dockNow = root.querySelector(".gx-journey__footer-dock");
      const dockBox = dockNow?.getBoundingClientRect();
      const dockInView = Boolean(
        dockBox && dockBox.bottom > 0 && dockBox.top < (height || window.innerHeight),
      );
      if (
        !reduceMotion &&
        (progress < 1 ||
          dragging ||
          spinning ||
          tossing ||
          dockInView ||
          shownCleanProgress < 1 ||
          cleanGlobeJourneyOpacity(shownCleanProgress) > 0)
      ) {
        frame = requestAnimationFrame(tick);
      }
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
      renderer.resize(width, height, Math.min(1.5, window.devicePixelRatio || 1));
      sphereRenderer?.resize(width, height, window.devicePixelRatio || 1);
      play();
    };
    const onDown = (event: PointerEvent) => {
      dragging = true;
      grab(spin);
      // Only the docked globe is throwable. In the hero the glyph field is
      // scroll-morphed into the streams, so moving it would fight the layout.
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

    void createCelestialGlobeRenderer(sphereCanvas, play).then((created) => {
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
    if (!reduceMotion) {
      window.addEventListener("scroll", play, { passive: true });
    }
    window.addEventListener("resize", resize);
    if (grabbable) {
      pad.addEventListener("pointerdown", onDown);
      pad.addEventListener("pointermove", onDrag);
      pad.addEventListener("pointerup", onUp);
      pad.addEventListener("pointercancel", onUp);
    }
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    if (document.fonts && document.fonts.status !== "loaded") {
      void document.fonts.ready.then(() => {
        if (!disposed) {
          renderer.refreshAtlas();
          play();
        }
      });
    }

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      if (!reduceMotion) window.removeEventListener("scroll", play);
      window.removeEventListener("resize", resize);
      if (grabbable) {
        pad.removeEventListener("pointerdown", onDown);
        pad.removeEventListener("pointermove", onDrag);
        pad.removeEventListener("pointerup", onUp);
        pad.removeEventListener("pointercancel", onUp);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      sphereRenderer?.dispose();
      renderer.dispose();
      sphereCanvas.parentElement?.style.removeProperty("clip-path");
    };
  }, [reduced]);

  return (
    <div ref={rootRef} className="gx-journey">
      <div className="gx-journey__sticky" aria-hidden>
        <div ref={backdropRef} className="gx-journey__disc" />
        <canvas ref={sphereCanvasRef} className="gx-journey__sphere" />
        <canvas ref={canvasRef} className="gx-journey__canvas" />
        <div ref={grabRef} className="gx-journey__grab" />
      </div>
      {children}
    </div>
  );
}
