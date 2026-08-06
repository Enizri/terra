/**
 * Live-preview plumbing shared by the landing theater and the workspace:
 * the preview iframe, the selection shape select.js posts back, the floating
 * dock drag, and the idle prompt typewriter. Nothing here may import a route.
 */
import { useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from "react";
import { preview } from "./api";

/* ---------- live preview ---------- */

/** What select.js (injected by the Go preview proxy) posts on click. */
export type LiveSelection = {
  name?: string;
  ownerChain?: string[];
  file?: string;
  line?: number | null;
  tag?: string;
  text?: string;
};

export function selectionLabel(sel: LiveSelection): string {
  return sel.name ?? sel.tag ?? "element";
}

export function liveSelectionId(sel: LiveSelection): string {
  return [sel.name ?? "", sel.file ?? "", String(sel.line ?? ""), sel.tag ?? "", (sel.text ?? "").slice(0, 40)].join("|");
}

export function LiveFrame({
  picking,
  frameRef,
  repoUrl,
}: {
  picking: boolean;
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** Which checkout to boot — the landing demo's, or the mapped repo. */
  repoUrl: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    preview(repoUrl, ac.signal)
      .then(setUrl)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ac.abort();
  }, [repoUrl]);

  const sendMode = () => {
    frameRef.current?.contentWindow?.postMessage({ type: "terra:mode", picking }, "*");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(sendMode, [picking]);

  if (error) return <div className="sh-live__status sh-live__status--error">Preview failed: {error}</div>;
  if (!url) return <div className="sh-live__status">Starting the dev server… first run can take a few minutes.</div>;
  return <iframe ref={frameRef} className="sh-live" src={url} onLoad={sendMode} title="Live preview" />;
}

/* ---------- floating drag (Cursor-style: transform + clamp, no layout thrash) ---------- */

/** Keep a sliver of the dock inside the drag arena so it can't be lost. */
const DRAG_PAD = 8;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Prefer the Power theater (wallpaper stage) as the drag arena so the chat
 * can roam freely onto the background; fall back to the preview panel.
 */
function resolveDragBounds(fallback: HTMLElement | null, shell: HTMLElement) {
  return (
    shell.closest<HTMLElement>(".sh-power-theater") ??
    shell.closest<HTMLElement>(".sh-stage") ??
    // Workspace: the whole shell, so the dock can roam over the map.
    shell.closest<HTMLElement>(".sh-ws") ??
    fallback
  );
}

/**
 * Pointer-drag a shell inside the theater/wallpaper arena. Writes
 * `translate3d` directly during the gesture (no React re-renders).
 */
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

/* ---------- streaming ask hint ---------- */

/** Typewriter cycle through suggestion options while the prompt is idle. */
export function useStreamingAskHint(paused: boolean, hints: readonly string[]) {
  const [hint, setHint] = useState("");
  const [full, setFull] = useState("");
  const index = useRef(0);
  const phase = useRef<"type" | "hold" | "delete">("type");
  const typed = useRef(0);
  const hintsKey = hints.join("\0");

  useEffect(() => {
    index.current = 0;
    phase.current = "type";
    typed.current = 0;
    setHint("");
    setFull(hints[0] ?? "");
  }, [hintsKey, hints]);

  useEffect(() => {
    if (paused || hints.length === 0) {
      setHint("");
      return;
    }

    let timer = 0;
    const tick = () => {
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
  }, [paused, hints, hintsKey]);

  return { text: hint, full };
}
