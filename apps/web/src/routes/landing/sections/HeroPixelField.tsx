import { useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import {
  decayHeat,
  depositHeat,
  FIELD_CELL,
  fieldSize,
  paintLayer,
  stampSparks,
} from "../pixelField";
import { nativeCursorFor, paintPointerArrow } from "../pointerArrow";

const NO_TRAIL =
  "a,button,[role='button'],input,textarea,select,label,summary," +
  "img,video,picture,canvas," +
  ".terra-finale__sky,.terra-finale__floor,.terra-finale__fore," +
  ".terra-finale__sun,.terra-finale__haze,.terra-finale__glow," +
  ".sh-window,.sh-replica,.gx-journey__grab";

/** Finale photo is `pointer-events: none` so clicks reach the globe. Hit
 *  testing therefore misses it and the trail would paint on the paper
 *  behind — use the card box instead. */
const NO_TRAIL_BOX = ".terra-finale__floor,.terra-finale__fore";

function overNoTrailBox(x: number, y: number): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(NO_TRAIL_BOX)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

function hitFromPoint(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!el.closest(".hx-field")) return el;
  }
  return null;
}

function fitField(canvas: HTMLCanvasElement, cols: number, rows: number) {
  canvas.width = cols * FIELD_CELL;
  canvas.height = rows * FIELD_CELL;
}

function fitOverlay(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.ceil(width * dpr));
  canvas.height = Math.max(1, Math.ceil(height * dpr));
}

/** Custom pointer everywhere; Terra-colored trail only on the marketing
 *  front page. Portaled onto body so the cursor can sit above the nav. */
export function HeroPixelField() {
  const reduced = useReducedMotion();
  const { pathname } = useLocation();
  const allowTrail = pathname === "/";
  const allowTrailRef = useRef(allowTrail);
  allowTrailRef.current = allowTrail;
  const trailRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const wakeRef = useRef<() => void>(() => {});
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    const trailCanvas = trailRef.current;
    const cursorCanvas = cursorRef.current;
    if (!trailCanvas || !cursorCanvas || !host) return;

    const trailCtx = trailCanvas.getContext("2d");
    const cursorCtx = cursorCanvas.getContext("2d");
    if (!trailCtx || !cursorCtx) return;

    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const livePointer = Boolean(!reduced && fine);
    if (livePointer) document.documentElement.classList.add("is-custom-pointer");

    let disposed = false;
    let frame = 0;
    let cols = 0;
    let rows = 0;
    let viewW = 0;
    let viewH = 0;
    let trail = new Float32Array(0);
    let hues = new Float32Array(0);
    let mx = -1;
    let my = -1;
    let pmx = -1;
    let pmy = -1;
    let hovering = false;
    let onLayer = false;
    let native: "pointer" | "text" | null = null;
    let lastSync = 0;

    const root = document.documentElement;

    /** One hit test drives both answers, so the trail and the cursor can never
     *  disagree about what is under the tip. */
    const syncHit = () => {
      if (mx < 0) return;
      const el = hitFromPoint(mx, my);
      onLayer =
        !allowTrailRef.current || overNoTrailBox(mx, my) || Boolean(el?.closest(NO_TRAIL));
      const next = nativeCursorFor(el);
      if (next === native) return;
      native = next;
      root.classList.toggle("is-native-pointer", Boolean(next));
      if (next) root.style.setProperty("--sh-native-cursor", next);
      else root.style.removeProperty("--sh-native-cursor");
    };

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      viewW = w;
      viewH = h;
      const size = fieldSize(w, h);
      cols = size.cols;
      rows = size.rows;
      trail = new Float32Array(cols * rows);
      hues = new Float32Array(cols * rows);
      fitField(trailCanvas, cols, rows);
      fitOverlay(cursorCanvas, w, h);
    };

    const play = () => {
      if (disposed || !livePointer || frame) return;
      frame = requestAnimationFrame(tick);
    };
    wakeRef.current = play;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      mx = e.clientX;
      my = e.clientY;
      hovering = true;
      lastSync = performance.now();
      syncHit();
      play();
    };
    const onLeave = (e: PointerEvent) => {
      // Iframes and capture make `pointerleave` fire even when the mouse is
      // still on the page — keep the last cursor so it does not vanish.
      if (e.relatedTarget) return;
    };

    const tick = () => {
      frame = 0;
      if (disposed) return;
      // Chips vanish and panels open under a cursor that never moved, so no
      // `pointermove` arrives to correct a stale answer — re-test on a beat.
      const now = performance.now();
      if (hovering && now - lastSync > 90) {
        lastSync = now;
        syncHit();
      }
      const size = { cols, rows };
      const trailPages = allowTrailRef.current;
      if (trailPages && hovering && mx >= 0 && !onLayer) {
        depositHeat(trail, size, mx, my, 0.38, 1.35);
        stampSparks(trail, hues, size, mx, my, 1.6, 0.28);
        if (pmx >= 0) {
          const dx = mx - pmx;
          const dy = my - pmy;
          const dist = Math.hypot(dx, dy);
          const steps = Math.min(12, Math.ceil(dist / (FIELD_CELL * 0.7)));
          for (let i = 1; i < steps; i += 1) {
            const u = i / steps;
            const x = pmx + dx * u;
            const y = pmy + dy * u;
            depositHeat(trail, size, x, y, 0.3, 1.2);
            stampSparks(trail, hues, size, x, y, 1.45, 0.24);
          }
        }
        pmx = mx;
        pmy = my;
      } else {
        pmx = -1;
        pmy = -1;
      }
      if (!trailPages || onLayer) trail.fill(0);
      const liveTrail = trailPages ? decayHeat(trail, onLayer ? 0.35 : 0.88) : 0;
      if (trailPages) paintLayer(trailCtx, trail, size, "trail", hues);
      else trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
      const dpr = window.devicePixelRatio || 1;
      cursorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cursorCtx.clearRect(0, 0, viewW, viewH);
      // Same size, same rim, everywhere — the glyph must not restyle itself
      // depending on what happens to sit under it.
      if (hovering && mx >= 0 && !native) paintPointerArrow(cursorCtx, mx, my);
      if (hovering || liveTrail > 0) {
        frame = requestAnimationFrame(tick);
      }
    };

    resize();
    if (livePointer) {
      document.addEventListener("pointermove", onMove, { passive: true, capture: true });
      document.addEventListener("pointerdown", onMove, { passive: true, capture: true });
      document.addEventListener("pointerleave", onLeave, { capture: true });
    }
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerdown", onMove, true);
      document.removeEventListener("pointerleave", onLeave, true);
      window.removeEventListener("resize", resize);
      root.classList.remove("is-custom-pointer", "is-native-pointer");
      root.style.removeProperty("--sh-native-cursor");
    };
  }, [reduced, host]);

  useEffect(() => {
    wakeRef.current();
  }, [allowTrail]);

  if (!host) return null;
  return createPortal(
    <>
      <div className="hx-field hx-field--trail" aria-hidden hidden={!allowTrail}>
        <canvas ref={trailRef} className="hx-field__canvas" />
      </div>
      <div className="hx-field hx-field--cursor" aria-hidden>
        <canvas ref={cursorRef} className="hx-field__canvas" />
      </div>
    </>,
    host,
  );
}
