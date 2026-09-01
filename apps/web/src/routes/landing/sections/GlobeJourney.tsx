import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RepoDiagram } from "../../../features/architecture-map";
import {
  createCelestialGlobeRenderer,
  type CelestialGlobeRenderer,
} from "../celestialGlobe3D";
import { diagramEdges, diagramGroups, diagramNodes } from "../data";
import { createGlobeRenderer } from "../globeGL";
import {
  HOVER_R,
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

const MOUSE_LOOK = 0.22;
const MAP_FILL = 0.72;
const PRESENCE_IN = 0.4;
const PRESENCE_OUT = 0.25;

/** One canvas owns the globe from the hero through its entry into the screen. */
export function GlobeJourney({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sphereCanvasRef = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapPx, setMapPx] = useState(0);
  const mapPxRef = useRef(0);
  const pointer = useRef({
    x: -1e4,
    y: -1e4,
    nx: 0,
    ny: 0,
    sx: 0,
    sy: 0,
    presence: 0,
  });

  useEffect(() => {
    const reduceMotion = Boolean(reduced);
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const sphereCanvas = sphereCanvasRef.current;
    const backdrop = backdropRef.current;
    const map = mapRef.current;
    if (!root || !canvas || !sphereCanvas || !backdrop || !map) return;
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
    const mouseFollow = (dt: number) => 1 - Math.pow(0.9, dt * 60);

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
      const p = pointer.current;
      const k = mouseFollow(dt);
      p.sx += (p.nx - p.sx) * k;
      p.sy += (p.ny - p.sy) * k;

      const overGlobe = Math.hypot(p.x - startX, p.y - startY) < size * 0.48;
      const targetPresence = progress < 0.02 && overGlobe ? 1 : 0;
      const tau = targetPresence > p.presence ? PRESENCE_IN : PRESENCE_OUT;
      p.presence +=
        (targetPresence - p.presence) * (1 - Math.exp(-dt / Math.max(tau, 0.001)));
      const sourcePointerX =
        progress < 0.03 ? p.x - (startX - width / 2) : -1e4;
      const sourcePointerY =
        progress < 0.03 ? p.y - (startY - height / 2) : -1e4;
      const yaw = p.sx * MOUSE_LOOK + progress * 0.42;
      const pitch = -p.sy * MOUSE_LOOK * 0.4 + progress * -0.08;

      const glyphs = layoutGlobeJourney(
        {
          size,
          width,
          height,
          t: globeT,
          pointerX: sourcePointerX,
          pointerY: sourcePointerY,
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

      const mapD = size * MAP_FILL;
      if (Math.round(mapD) !== mapPxRef.current) {
        mapPxRef.current = Math.round(mapD);
        setMapPx(Math.round(mapD));
      }
      map.style.width = `${mapD}px`;
      map.style.height = `${mapD}px`;
      map.style.left = `${startX}px`;
      map.style.top = `${startY}px`;
      map.style.opacity = String(p.presence * (1 - progress));
      map.classList.toggle("is-live", p.presence > 0.2 && progress < 0.02);
      const localX = p.x - (startX - mapD / 2);
      const localY = p.y - (startY - mapD / 2);
      map.style.clipPath = p.presence > 0.02
        ? `circle(${size * 0.5 * HOVER_R}px at ${localX}px ${localY}px)`
        : "circle(0px at 50% 50%)";
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
        (progress < 1 || shownCleanProgress < 1 || cleanGlobeJourneyOpacity(shownCleanProgress) > 0)
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
    const onMove = (event: PointerEvent) => {
      const p = pointer.current;
      p.x = event.clientX;
      p.y = event.clientY;
      p.nx = (event.clientX / window.innerWidth) * 2 - 1;
      p.ny = (event.clientY / window.innerHeight) * 2 - 1;
      play();
    };
    const onLeave = () => {
      const p = pointer.current;
      p.x = -1e4;
      p.y = -1e4;
      p.nx = 0;
      p.ny = 0;
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
    if (!reduceMotion) {
      window.addEventListener("scroll", play, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
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
      if (!reduceMotion) {
        window.removeEventListener("scroll", play);
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
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
        <div ref={mapRef} className="hx-orb__map">
          <RepoDiagram
            nodes={diagramNodes}
            edges={diagramEdges}
            groups={diagramGroups}
            hoverOnly
            remeasureKey={mapPx}
          />
        </div>
        <canvas ref={canvasRef} className="gx-journey__canvas" />
      </div>
      {children}
    </div>
  );
}
