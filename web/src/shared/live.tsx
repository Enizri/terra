/** Domain-neutral floating-drag + typewriter hint hooks (no feature imports). */
import { useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from "react";

const DRAG_PAD = 8;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function resolveDragBounds(fallback: HTMLElement | null, shell: HTMLElement) {
  return (
    shell.closest<HTMLElement>(".sh-power-theater") ??
    shell.closest<HTMLElement>(".sh-stage") ??
    shell.closest<HTMLElement>(".sh-ws") ??
    fallback
  );
}

/** Pointer-drag with translate3d; no React re-renders during the gesture. */
export function useFloatingDrag(boundsRef: RefObject<HTMLElement | null>) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const dragging = useRef(false);

  const paint = () => {
    const el = shellRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${offset.current.x}px, ${offset.current.y}px, 0)`;
  };

  const onHeadPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, input, a, [data-no-drag]")) return;
    const shell = shellRef.current;
    const bounds = resolveDragBounds(boundsRef.current, shell ?? (e.currentTarget as HTMLElement));
    if (!shell || !bounds) return;

    e.preventDefault();
    shell.setPointerCapture(e.pointerId);

    const br = bounds.getBoundingClientRect();
    const sr = shell.getBoundingClientRect();
    const restingLeft = sr.left - offset.current.x;
    const restingTop = sr.top - offset.current.y;
    const w = shell.offsetWidth;
    const h = shell.offsetHeight;

    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.current.x,
      originY: offset.current.y,
      minX: br.left + DRAG_PAD - restingLeft,
      maxX: br.right - DRAG_PAD - restingLeft - w,
      minY: br.top + DRAG_PAD - restingTop,
      maxY: br.bottom - DRAG_PAD - restingTop - h,
    };
    dragging.current = true;
    shell.classList.add("is-dragging");
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    const maxX = Math.max(g.minX, g.maxX);
    const maxY = Math.max(g.minY, g.maxY);
    offset.current = {
      x: clamp(g.originX + (e.clientX - g.startX), g.minX, maxX),
      y: clamp(g.originY + (e.clientY - g.startY), g.minY, maxY),
    };
    paint();
  };

  const endGesture = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pointerId) return;
    gesture.current = null;
    dragging.current = false;
    shellRef.current?.classList.remove("is-dragging");
    try {
      shellRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return { shellRef, onHeadPointerDown, onPointerMove, endGesture };
}

/** Idle typewriter through suggestion options. */
export function useStreamingAskHint(paused: boolean, hints: readonly string[]) {
  const [hint, setHint] = useState("");
  const [full, setFull] = useState("");
  const index = useRef(0);
  const phase = useRef<"type" | "hold" | "delete">("type");
  const typed = useRef(0);
  const hintsKey = hints.join("\0");
  // Callers often rebuild the hints array every render; depending on its
  // identity would reset the animation on every typed character. Key the
  // effects on content (hintsKey) and read the array through a ref.
  const hintsRef = useRef(hints);
  hintsRef.current = hints;

  useEffect(() => {
    index.current = 0;
    phase.current = "type";
    typed.current = 0;
    setHint("");
    setFull(hintsRef.current[0] ?? "");
  }, [hintsKey]);

  useEffect(() => {
    if (paused || hintsRef.current.length === 0) {
      setHint("");
      return;
    }

    let timer = 0;
    const tick = () => {
      const hints = hintsRef.current;
      const current = hints[index.current % hints.length];
      setFull(current);
      if (phase.current === "type") {
        typed.current = Math.min(current.length, typed.current + 1);
        setHint(current.slice(0, typed.current));
        if (typed.current >= current.length) {
          phase.current = "hold";
          timer = window.setTimeout(tick, 900);
          return;
        }
        timer = window.setTimeout(tick, 12 + Math.random() * 10);
        return;
      }
      if (phase.current === "hold") {
        phase.current = "delete";
        timer = window.setTimeout(tick, 10);
        return;
      }
      typed.current = Math.max(0, typed.current - 1);
      setHint(current.slice(0, typed.current));
      if (typed.current <= 0) {
        index.current = (index.current + 1) % hints.length;
        phase.current = "type";
        timer = window.setTimeout(tick, 120);
        return;
      }
      timer = window.setTimeout(tick, 8);
    };

    timer = window.setTimeout(tick, 160);
    return () => window.clearTimeout(timer);
  }, [paused, hintsKey]);

  return { text: hint, full };
}
