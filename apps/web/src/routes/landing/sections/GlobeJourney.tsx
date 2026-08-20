import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RepoDiagram } from "../../../features/architecture-map";
import { diagramEdges, diagramGroups, diagramNodes } from "../data";
import { createGlobeRenderer } from "../globeGL";
import {
  HOVER_R,
  globeJourneyProgress,
  layoutGlobeJourney,
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
    if (reduced) return;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const backdrop = backdropRef.current;
    const map = mapRef.current;
    if (!root || !canvas || !backdrop || !map) return;
    const renderer = createGlobeRenderer(canvas);
    if (!renderer || renderer === "lost") return;

    let disposed = false;
    let frame = 0;
    let visible = true;
    let width = 0;
    let height = 0;
    let startedAt = -1;
    let last = 0;
    const mouseFollow = (dt: number) => 1 - Math.pow(0.9, dt * 60);

    const draw = (now: number, dt: number) => {
      if (disposed || width <= 0 || height <= 0) return 1;
      if (startedAt < 0) startedAt = now;
      const rootRect = root.getBoundingClientRect();
      if (rootRect.bottom < 0 || rootRect.top > height) return 1;
      const screen = root.querySelector<HTMLElement>(
        ".sh-power-theater__screen .sh-window",
      );
      if (!screen) return 1;

      const canvasRect = canvas.getBoundingClientRect();
      const screenRect = screen.getBoundingClientRect();
      const progress = globeJourneyProgress(rootRect.top, screenRect.top, height);
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

      const glyphs = layoutGlobeJourney(
        {
          size,
          width,
          height,
          t: 2 + (now - startedAt) / 1000 + progress * 6,
          pointerX: sourcePointerX,
          pointerY: sourcePointerY,
          yaw: p.sx * MOUSE_LOOK + progress * 0.42,
          pitch: -p.sy * MOUSE_LOOK * 0.4 + progress * -0.08,
          reduced: false,
          progress,
          startX,
          startY,
          targetX,
          targetY,
        },
        renderer.data,
      );
      renderer.render({ glyphs });

      const discFade = 1 - Math.min(1, Math.max(0, progress / 0.3));
      const travel = progress * progress * (3 - 2 * progress);
      const centerX = startX + (targetX - startX) * travel;
      const centerY =
        startY + (targetY - startY) * travel - Math.sin(travel * Math.PI) * height * 0.08;
      backdrop.style.width = `${size}px`;
      backdrop.style.height = `${size}px`;
      backdrop.style.opacity = String(discFade);
      backdrop.style.transform = `translate3d(${centerX - size / 2}px, ${centerY - size / 2}px, 0)`;

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
      return progress;
    };

    const tick = (now: number) => {
      frame = 0;
      if (disposed || !visible || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const progress = draw(now, dt);
      if (progress < 1) frame = requestAnimationFrame(tick);
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
    window.addEventListener("scroll", play, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
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
      window.removeEventListener("scroll", play);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.dispose();
    };
  }, [reduced]);

  if (reduced) return <>{children}</>;

  return (
    <div ref={rootRef} className="gx-journey">
      <div className="gx-journey__sticky" aria-hidden>
        <div ref={backdropRef} className="gx-journey__disc" />
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
