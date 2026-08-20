import { useEffect, useRef, useState } from "react";
import { copy } from "../data";
import { createGlobeRenderer } from "../globeGL";
import { layoutGlobe } from "../globeLayout";

/** Mouse-look: max lean toward the cursor, radians. */
const MOUSE_LOOK = 0.22;

/** Circle of monospace glyphs that churn and warm up under the pointer.
 *  Layout is CPU; the GPU draws every glyph in one instanced call. */
function GlyphOrb() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Pointer and its smoothed follower live in refs: state here would
  // re-render the hero 60x/sec.
  const pointer = useRef({ x: -1e4, y: -1e4, nx: 0, ny: 0, sx: 0, sy: 0 });
  const reducedRef = useRef(false);
  // A lost context (Strict Mode / HMR after loseContext) cannot be reused;
  // bumping this mounts a fresh <canvas>.
  const [surface, setSurface] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createGlobeRenderer(canvas);
    if (renderer === "lost") {
      if (surface < 3) setSurface((n) => n + 1);
      return;
    }
    if (!renderer) return;

    let disposed = false;
    let size = 0;
    let paneW = 0;
    let paneH = 0;
    let frame = 0;
    let visible = true;
    let start = -1;
    let last = 0;
    const mouseFollow = (dt: number) => 1 - Math.pow(0.9, dt * 60);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReduced = () => {
      reducedRef.current = media.matches;
    };
    syncReduced();

    const draw = (now: number, dt: number) => {
      if (paneW <= 0 || paneH <= 0) return;
      if (start < 0) start = now;
      const t = (now - start) / 1000;
      const p = pointer.current;
      const k = mouseFollow(dt);
      p.sx += (p.nx - p.sx) * k;
      p.sy += (p.ny - p.sy) * k;
      const count = layoutGlobe(
        {
          size,
          width: paneW,
          height: paneH,
          t,
          pointerX: p.x,
          pointerY: p.y,
          yaw: p.sx * MOUSE_LOOK,
          pitch: -p.sy * MOUSE_LOOK * 0.4,
          reduced: reducedRef.current,
        },
        renderer.data,
      );
      renderer.render(count);
    };

    const tick = (now: number) => {
      frame = 0;
      if (disposed || !visible || document.hidden || reducedRef.current) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      draw(now, dt);
      frame = requestAnimationFrame(tick);
    };

    const play = () => {
      if (frame || disposed || !visible || document.hidden || reducedRef.current) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const resize = () => {
      const host = canvas.parentElement;
      const rect = host?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      paneW = rect.width;
      paneH = rect.height;
      if (paneW <= 0 || paneH <= 0) return;
      size = Math.max(paneW, paneH) * 0.82;
      renderer.resize(paneW, paneH, Math.min(1.5, window.devicePixelRatio || 1));
      draw(performance.now(), 1 / 60);
    };

    const onWindowMove = (e: PointerEvent) => {
      const p = pointer.current;
      p.nx = (e.clientX / window.innerWidth) * 2 - 1;
      p.ny = (e.clientY / window.innerHeight) * 2 - 1;
      const rect = canvas.getBoundingClientRect();
      p.x = e.clientX - rect.left;
      p.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      const p = pointer.current;
      p.nx = 0;
      p.ny = 0;
      p.x = -1e4;
      p.y = -1e4;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) play();
      else stop();
    });
    io.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (visible) play();
    };
    document.addEventListener("visibilitychange", onVisibility);
    media.addEventListener("change", syncReduced);

    window.addEventListener("pointermove", onWindowMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    resize();
    if (document.fonts && document.fonts.status !== "loaded") {
      void document.fonts.ready.then(() => {
        if (!disposed) renderer.refreshAtlas();
      });
    }
    play();

    return () => {
      disposed = true;
      stop();
      renderer.dispose();
      observer.disconnect();
      io.disconnect();
      media.removeEventListener("change", syncReduced);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onWindowMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [surface]);

  return <canvas key={surface} ref={canvasRef} className="hx-orb__canvas" aria-hidden />;
}

export function HeroChars() {
  return (
    <section className="sh-section sh-section--hero sh-section--herochars" aria-label="Hero">
      <div className="hx-grid">
        <div className="hx-copy">
          <p className="hx-eyebrow">{copy.heroEyebrow}</p>
          <h1 className="hx-title">{copy.heroHeadline}</h1>
          <p className="hx-body">{copy.heroSubtitle}</p>
          <div className="hx-cta">
            <a className="hx-cta__btn" href={copy.heroCta.primary.href}>
              {copy.heroCta.primary.label}
            </a>
            <a className="hx-cta__btn" href={copy.heroCta.secondary.href}>
              {copy.heroCta.secondary.label}
            </a>
          </div>
        </div>

        <div className="hx-orb">
          <GlyphOrb />
        </div>
      </div>
    </section>
  );
}
