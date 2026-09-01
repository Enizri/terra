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
  cleanGlobeJourneyOpacity,
  cleanGlobeJourneyProgress,
  cleanGlobeJourneyScale,
  cleanGlobeJourneyTravel,
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
    let dragging = false;
    let spinning = false;
    let lastDragX = 0;
    let lastDragY = 0;
    let lastDragT = 0;
    let grabRadius = 1;

    const draw = (dt: number) => {
      if (disposed || width <= 0 || height <= 0) return 1;
      const rootRect = root.getBoundingClientRect();
      if (rootRect.bottom < 0 || rootRect.top > height) return 1;
      const screen = root.querySelector<HTMLElement>(
        ".sh-power-theater__screen .sh-window",
      );
      const dock = root.querySelector<HTMLElement>(".gx-journey__footer-dock");
      if (!screen || !dock) return 1;

      const canvasRect = canvas.getBoundingClientRect();
      const screenRect = screen.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const targetProgress = reduceMotion
        ? 0
        : globeJourneyProgress(window.scrollY, screenRect.top, height);
      shownProgress = smoothGlobeJourneyProgress(shownProgress, targetProgress, dt);
      const progress = shownProgress;
      const targetCleanProgress = reduceMotion
        ? 0
        : cleanGlobeJourneyProgress(dockRect.top, height);
      shownCleanProgress = smoothGlobeJourneyProgress(
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
      const cleanTravel = cleanGlobeJourneyTravel(shownCleanProgress);
      const cleanArc = Math.sin(cleanTravel * Math.PI);
      if (!reduceMotion && shownCleanProgress > 0) cleanT += dt;
      const cleanStartX = width * (desktop ? 0.5 : 0.5);
      const cleanStartY = height + size * 0.28;
      const cleanTargetX = width * (desktop ? 0.62 : 0.5);
      // Keep the finished sphere fully inside the light bridge; the footer
      // begins before the sticky viewport ends.
      const cleanTargetY = height * (desktop ? 0.30 : 0.28);
      const cleanX = cleanStartX + (cleanTargetX - cleanStartX) * cleanTravel +
        cleanArc * size * (desktop ? 0.08 : 0.03);
      const cleanY = cleanStartY + (cleanTargetY - cleanStartY) * cleanTravel;
      const cleanOpacity = cleanGlobeJourneyOpacity(shownCleanProgress);
      const cleanActive = cleanOpacity > 0.001;
      sphereCanvas.parentElement?.classList.toggle("is-clean-flight", cleanActive);
      sphereRenderer?.render({
        width,
        height,
        diameter: size * MAP_FILL * (
          cleanActive ? cleanGlobeJourneyScale(shownCleanProgress) : 1
        ),
        x: cleanActive ? cleanX : centerX,
        y: cleanActive ? cleanY : centerY,
        yaw,
        pitch,
        spin: reduceMotion ? 0.35 : globeT * 0.22 + cleanT * 0.18,
        opacity: cleanActive ? cleanOpacity : discFade,
        emergence: cleanActive ? Math.max(0.03, cleanTravel) : 1,
      });

      // The handle rides the globe exactly like the disc behind it.
      grabRadius = size / 2;
      pad.style.width = `${size}px`;
      pad.style.height = `${size}px`;
      pad.style.transform =
        `translate3d(${centerX - size / 2}px, ${centerY - size / 2}px, 0)`;
      pad.classList.toggle("is-grabbable", progress < GRAB_UNTIL);
      return Math.min(progress, shownCleanProgress);
    };

    const tick = (now: number) => {
      frame = 0;
      if (disposed || !visible || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const progress = draw(dt);
      if (
        !reduceMotion &&
        (progress < 1 ||
          dragging ||
          spinning ||
          shownCleanProgress < 1 ||
          cleanGlobeJourneyOpacity(shownCleanProgress) > 0)
      ) {
        frame = requestAnimationFrame(tick);
      }
    };
    const play = () => {
      if (frame || disposed || !visible || document.hidden) return;
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
      dragBy(
        spin,
        event.clientX - lastDragX,
        event.clientY - lastDragY,
        grabRadius,
        dt,
      );
      lastDragX = event.clientX;
      lastDragY = event.clientY;
      lastDragT = event.timeStamp;
      play();
    };
    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      release(spin);
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
    intersectionObserver.observe(root);
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
      if (grabbable) {
        pad.removeEventListener("pointerdown", onDown);
        pad.removeEventListener("pointermove", onDrag);
        pad.removeEventListener("pointerup", onUp);
        pad.removeEventListener("pointercancel", onUp);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      sphereRenderer?.dispose();
      renderer.dispose();
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
