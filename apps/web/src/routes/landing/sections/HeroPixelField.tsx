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
import {
  createPointerSprite,
  isClickableElement,
  POINTER_SCALE,
  type PointerSprite,
} from "../pointerArrow";

/** Surfaces the trail must not paint on. Tags and cards only — every press
 *  target is caught by `isClickableElement` instead, which knows the ones that
 *  are plain boxes with a handler (`[role]`, `[data-sel]`, `.rp-btn`) and
 *  would otherwise take the colour across a component you are hovering. */
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

/** How often a pointer that is not moving re-tests what sits under it. */
const HIT_BEAT = 90;

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

function fitOverlay(canvas: HTMLCanvasElement, width: number, height: number, dpr: number) {
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
    const root = document.documentElement;
    if (livePointer) root.classList.add("is-custom-pointer");

    let disposed = false;
    let frame = 0;
    let beat = 0;
    let cols = 0;
    let rows = 0;
    let dpr = 0;
    let sprite: PointerSprite | null = null;
    let trail = new Float32Array(0);
    let hues = new Float32Array(0);
    let mx = -1;
    let my = -1;
    let pmx = -1;
    let pmy = -1;
    // Where the last hit test was taken, so a still pointer never repeats one.
    let hitX = -1;
    let hitY = -1;
    let hovering = false;
    let onLayer = false;
    // The glyph's last blit, so a frame clears what it drew rather than the
    // whole viewport.
    let painted: { x: number; y: number; w: number; h: number } | null = null;
    // Something the canvases show has changed. Without it the loop parks.
    let dirty = false;

    /** Hit testing controls where the trail is painted. Run at most once
     *  per frame rather than once per pointer event. */
    const syncHit = () => {
      if (mx < 0) return;
      hitX = mx;
      hitY = my;
      const el = hitFromPoint(mx, my);
      const layer =
        !allowTrailRef.current ||
        overNoTrailBox(mx, my) ||
        Boolean(el?.closest(NO_TRAIL)) ||
        isClickableElement(el);
      if (layer !== onLayer) {
        onLayer = layer;
        dirty = true;
      }
    };

    /** The heat field exists only where the trail is drawn. Off it, there is
     *  no buffer to sweep and no canvas to clear. */
    const syncBuffers = () => {
      const want = allowTrailRef.current ? cols * rows : 0;
      if (trail.length !== want) {
        trail = new Float32Array(want);
        hues = new Float32Array(want);
      }
      if (want) fitField(trailCanvas, cols, rows);
      else if (trailCanvas.width || trailCanvas.height) {
        // Zeroing the backing store drops the memory and the paint at once.
        trailCanvas.width = 0;
        trailCanvas.height = 0;
      }
    };

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const size = fieldSize(w, h);
      cols = size.cols;
      rows = size.rows;
      syncBuffers();
      dpr = window.devicePixelRatio || 1;
      fitOverlay(cursorCanvas, w, h, dpr);
      // Resizing the canvas clears it and resets the transform; the glyph is
      // baked at the new ratio and there is nothing left to erase.
      cursorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sprite = createPointerSprite(dpr, POINTER_SCALE);
      painted = null;
      dirty = true;
      play();
    };

    const play = () => {
      if (disposed || !livePointer || frame || document.hidden) return;
      frame = requestAnimationFrame(tick);
    };

    const onBeat = () => {
      // Chips vanish and panels open under a cursor that never moved, so no
      // `pointermove` arrives to correct a stale answer — re-test on a beat.
      if (!hovering || document.hidden) return;
      syncHit();
      if (dirty) play();
    };
    const startBeat = () => {
      if (!beat && livePointer) beat = window.setInterval(onBeat, HIT_BEAT);
    };
    const stopBeat = () => {
      if (!beat) return;
      window.clearInterval(beat);
      beat = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      if (hovering && e.clientX === mx && e.clientY === my) return;
      mx = e.clientX;
      my = e.clientY;
      hovering = true;
      dirty = true;
      startBeat();
      play();
    };
    const onPress = (e: PointerEvent) => {
      // A press rebuilds chips and opens panels under a pointer that has not
      // moved. Retire the last hit so the next frame takes a fresh one rather
      // than waiting out the beat. It also adopts the position, so a click
      // that arrives before any movement still puts the glyph on screen —
      // the OS cursor is already hidden by then.
      hitX = -1;
      onMove(e);
      play();
    };
    const onLeave = (e: PointerEvent) => {
      // Iframes and capture make `pointerleave` fire even when the mouse is
      // still on the page — only the one that leaves `<html>` with nowhere
      // else to go means the pointer really left the window.
      if (e.relatedTarget || e.target !== root) return;
      hovering = false;
      dirty = true;
      stopBeat();
      play();
    };
    const onVisibility = () => {
      if (document.hidden) {
        stopBeat();
        return;
      }
      if (hovering) startBeat();
      dirty = true;
      play();
    };

    const tick = () => {
      frame = 0;
      if (disposed || document.hidden) return;
      if (mx !== hitX || my !== hitY) syncHit();

      const size = { cols, rows };
      const trailPages = allowTrailRef.current && trail.length > 0;
      let liveTrail = 0;
      if (trailPages) {
        if (hovering && mx >= 0 && !onLayer) {
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
        if (onLayer) trail.fill(0);
        liveTrail = decayHeat(trail, onLayer ? 0.35 : 0.88);
        paintLayer(trailCtx, trail, size, "trail", hues);
      }

      // Keep the same sprite across component boundaries. Swapping sizes on
      // hover makes the cursor pop even when the pointer has barely moved.
      if (painted) {
        cursorCtx.clearRect(painted.x - 1, painted.y - 1, painted.w + 2, painted.h + 2);
        painted = null;
      }
      const glyph = sprite;
      if (hovering && mx >= 0 && glyph) {
        // Land the blit on the device pixel grid — the real cursor does, and
        // a half-pixel offset costs the glyph its crisp rim.
        const x = Math.round((mx - glyph.hotX) * dpr) / dpr;
        const y = Math.round((my - glyph.hotY) * dpr) / dpr;
        cursorCtx.drawImage(glyph.canvas, x, y, glyph.width, glyph.height);
        painted = { x, y, w: glyph.width, h: glyph.height };
      }

      dirty = false;
      // A still pointer over a dead field has nothing to redraw. `onMove` and
      // the beat wake the loop; it does not idle at 60fps waiting for them.
      if (liveTrail > 0) frame = requestAnimationFrame(tick);
    };

    wakeRef.current = () => {
      // The route changed, so both the field and what sits under the tip did.
      syncBuffers();
      hitX = -1;
      dirty = true;
      play();
    };

    resize();
    if (livePointer) {
      document.addEventListener("pointermove", onMove, { passive: true, capture: true });
      document.addEventListener("pointerdown", onPress, { passive: true, capture: true });
      document.addEventListener("pointerleave", onLeave, { capture: true });
      document.addEventListener("visibilitychange", onVisibility);
    }
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      stopBeat();
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("pointerleave", onLeave, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      root.classList.remove("is-custom-pointer");
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
