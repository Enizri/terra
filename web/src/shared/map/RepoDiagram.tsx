// Repo map renderer (landing mock + /analyze results).

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { rise, spring } from "../motion";
import TechIcon from "./TechIcon";
import type { DiagramEdgeView, DiagramGroupView, DiagramNodeView } from "./diagramViews";

export type {
  DiagramEdgeView,
  DiagramGroupView,
  DiagramKind,
  DiagramNodeView,
} from "./diagramViews";

const colDelay = (col: number) => 0.15 + col * 0.4;
const nodeDelay = (n: DiagramNodeView) => colDelay(n.col) + 0.1 + n.row * 0.08;

type EdgeRef = { from: string; to: string };
const edgeKey = (e: EdgeRef) => `${e.from}-${e.to}`;

const ARROW_GAP = 6;
const DETOUR = 14;

type Box = { x: number; y: number; w: number; h: number };

/** Offset of `el` relative to `stop` via offsetParent chain (ignores transforms). */
function offsetWithin(el: HTMLElement, stop: HTMLElement) {
  let x = 0;
  let y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== stop) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

type Route = { d: string; mid: { x: number; y: number } };

/** Orthogonal edge router (column hop, neighbour, or same-column detour). */
function routeEdge(a: DiagramNodeView, b: DiagramNodeView, ra: Box, rb: Box): Route | null {
  // 0×0 boxes (hidden / pre-paint) would anchor at the canvas origin.
  if (!ra.w || !ra.h || !rb.w || !rb.h) return null;

  const ay = ra.y + ra.h / 2;
  const by = rb.y + rb.h / 2;
  let pts: { x: number; y: number }[];

  if (a.col !== b.col) {
    const x1 = ra.x + ra.w;
    const x2 = rb.x - ARROW_GAP;
    pts =
      Math.abs(ay - by) < 4
        ? [
            { x: x1, y: ay },
            { x: x2, y: ay },
          ]
        : (() => {
            const mx = (ra.x + ra.w + rb.x) / 2;
            return [
              { x: x1, y: ay },
              { x: mx, y: ay },
              { x: mx, y: by },
              { x: x2, y: by },
            ];
          })();
  } else if (Math.abs(a.row - b.row) === 1) {
    const cx = ra.x + ra.w / 2;
    const down = b.row > a.row;
    pts = [
      { x: cx, y: down ? ra.y + ra.h : ra.y },
      { x: cx, y: down ? rb.y - ARROW_GAP : rb.y + rb.h + ARROW_GAP },
    ];
  } else {
    // Stagger by row distance so hub-and-spoke detours don't stack on one line.
    const dx = Math.min(ra.x, rb.x) - DETOUR * Math.abs(a.row - b.row);
    pts = [
      { x: ra.x, y: ay },
      { x: dx, y: ay },
      { x: dx, y: by },
      { x: rb.x - ARROW_GAP, y: by },
    ];
  }

  const round = (v: number) => Math.round(v * 10) / 10;
  const d = pts.map((p, i) => `${i ? "L" : "M"} ${round(p.x)} ${round(p.y)}`).join(" ");

  let best = 0;
  let mid = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    if (len > best) {
      best = len;
      mid = {
        x: (pts[i].x + pts[i - 1].x) / 2,
        y: (pts[i].y + pts[i - 1].y) / 2,
      };
    }
  }

  return { d, mid };
}

/** Left→right flow map; controlled selection; hoverOnly disables click. */
export default function RepoDiagram({
  nodes,
  edges,
  groups,
  header,
  overlay,
  hoverOnly = false,
  selectedId = null,
  pulseId = null,
  onSelect,
  legendNote,
  labelsOnHover = false,
  remeasureKey,
  scriptHoverId = null,
  scripted = false,
}: {
  nodes: DiagramNodeView[];
  edges: DiagramEdgeView[];
  groups: readonly DiagramGroupView[];
  header?: ReactNode;
  overlay?: ReactNode;
  hoverOnly?: boolean;
  selectedId?: string | null;
  pulseId?: string | null;
  onSelect?: (id: string | null, additive?: boolean) => void;
  legendNote?: string;
  /** Show edge captions only while lit. */
  labelsOnHover?: boolean;
  remeasureKey?: unknown;
  /** Script-driven hover (hero film) — real hover still wins. */
  scriptHoverId?: string | null;
  /** Inert scripted film: window-level listeners would leak to the page. */
  scripted?: boolean;
}) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const focus = hoverOnly ? null : selectedId;
  const active = hover ?? scriptHoverId ?? focus;

  const select = (id: string | null, additive?: boolean) => onSelect?.(id, additive);

  // Unique marker ids when multiple diagrams mount.
  const uid = useId().replace(/:/g, "");
  const arrowId = `dg-arrow-${uid}`;
  const arrowLitId = `dg-arrow-lit-${uid}`;
  const arrowBackId = `dg-arrow-back-${uid}`;
  const arrowBackLitId = `dg-arrow-back-lit-${uid}`;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeEls = useRef<Record<string, HTMLElement | null>>({});
  const [routes, setRoutes] = useState<Record<string, Route>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fit, setFit] = useState(1);
  const lastGeom = useRef("");

  useEffect(() => {
    if (hoverOnly || scripted || !focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, hoverOnly]);

  // Measure via offsetParent chain (ignores Motion transforms mid-entrance).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;

    const measure = () => {
      if (!alive || !canvas.clientWidth) return;
      const boxes: Record<string, Box> = {};
      for (const n of nodes) {
        const el = nodeEls.current[n.id];
        if (!el) continue;
        const at = offsetWithin(el, canvas);
        boxes[n.id] = { x: at.x, y: at.y, w: el.offsetWidth, h: el.offsetHeight };
      }
      const next: Record<string, Route> = {};
      for (const e of edges) {
        const [fromId, toId] = e.back ? [e.to, e.from] : [e.from, e.to];
        const a = byId[fromId];
        const b = byId[toId];
        const ra = boxes[fromId];
        const rb = boxes[toId];
        if (!a || !b || !ra || !rb) continue;
        const route = routeEdge(a, b, ra, rb);
        if (route) next[edgeKey(e)] = route;
      }
      // Scale content to fit the canvas on both axes; routes stay valid under
      // the scale. Where the columns are still allowed to flex-shrink, the
      // width term is ~1 and this behaves exactly like the old height-only fit.
      let topY = Infinity;
      let botY = -Infinity;
      let leftX = Infinity;
      let rightX = -Infinity;
      for (const el of canvas.querySelectorAll<HTMLElement>(
        ".sh-diagram__group, .sh-diagram__node",
      )) {
        const at = offsetWithin(el, canvas);
        topY = Math.min(topY, at.y);
        botY = Math.max(botY, at.y + el.offsetHeight);
        leftX = Math.min(leftX, at.x);
        rightX = Math.max(rightX, at.x + el.offsetWidth);
      }
      const flowEl = canvas.querySelector<HTMLElement>(".sh-diagram__flow");
      const availH = flowEl?.offsetHeight ?? 0;
      const availW = flowEl?.offsetWidth ?? 0;
      const contentH = botY - topY;
      const contentW = rightX - leftX;
      const fy = availH > 0 && contentH > availH ? availH / contentH : 1;
      const fx = availW > 0 && contentW > availW ? availW / contentW : 1;
      // Shrink only: scaling past 1 would fatten the fixed-size arrowheads.
      const f = Math.min(fx, fy);

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // `f` belongs in the signature: a resize can change the fit without
      // moving a single route, and this guard would then skip setFit.
      const sig = `${w}x${h}|${f}|${JSON.stringify(next)}`;
      if (sig === lastGeom.current) return;
      lastGeom.current = sig;

      setSize({ w, h });
      setRoutes(next);
      setFit(f);
    };

    measure();
    // Observe cards + flow; canvas-only misses content reflow / webfont swap.
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    const flow = canvas.querySelector(".sh-diagram__flow");
    if (flow) ro.observe(flow);
    for (const n of nodes) {
      const el = nodeEls.current[n.id];
      if (el) ro.observe(el);
    }
    document.fonts?.ready.then(measure).catch(() => {});

    // Scroll-driven landing windows resize outside the observer.
    let queued = 0;
    const onScroll = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        measure();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      alive = false;
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (queued) cancelAnimationFrame(queued);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, nodes, edges, remeasureKey]);

  const linked = new Set<string>();
  if (active) {
    linked.add(active);
    for (const e of edges) {
      if (e.from === active) linked.add(e.to);
      if (e.to === active) linked.add(e.from);
    }
  }

  const d = (delay: number) => (reduced ? 0 : delay);

  const cardBody = (n: DiagramNodeView) => (
    <>
      <span className="sh-diagram__node-top">
        <TechIcon tech={n.tech} kind={n.kind} label={n.label} />
        <span className="sh-diagram__name">{n.label}</span>
      </span>
      <span className="sh-diagram__purpose">{n.purpose}</span>
      <span className="sh-diagram__status">
        <motion.i
          className="sh-diagram__status-dot"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...spring, delay: d(nodeDelay(n) + 0.35) }}
        />
        Verified
      </span>
      {n.hint && (
        <span className="sh-diagram__foot">
          <span className="sh-diagram__hint">{n.hint}</span>
        </span>
      )}
    </>
  );

  const renderNode = (n: DiagramNodeView) => {
    const dim = active !== null && !linked.has(n.id);
    const lit = hoverOnly ? active === n.id : focus === n.id;
    const scriptHover = scriptHoverId === n.id ? " is-script-hover" : "";
    const enter = {
      initial: { opacity: 0, scale: 0.94, x: -12 },
      animate: { opacity: 1, scale: 1, x: 0 },
      transition: { ...spring, delay: d(nodeDelay(n)) },
    } as const;

    if (hoverOnly) {
      return (
        <motion.div
          key={n.id}
          ref={(el: HTMLDivElement | null) => {
            nodeEls.current[n.id] = el;
          }}
          data-node-id={n.id}
          className={`sh-diagram__node sh-diagram__node--${n.kind} sh-diagram__node--hover-only${
            lit ? " is-focus" : ""
          }${dim ? " is-dim" : ""}${scriptHover}`}
          onMouseEnter={() => setHover(n.id)}
          onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
          {...enter}
        >
          {cardBody(n)}
        </motion.div>
      );
    }
    return (
      <motion.button
        key={n.id}
        type="button"
        ref={(el: HTMLButtonElement | null) => {
          nodeEls.current[n.id] = el;
        }}
        data-node-id={n.id}
        className={`sh-diagram__node sh-diagram__node--${n.kind}${lit ? " is-focus" : ""}${
          dim ? " is-dim" : ""
        }${pulseId === n.id ? " is-pulse" : ""}${scriptHover}`}
        aria-pressed={focus === n.id}
        onMouseEnter={() => setHover(n.id)}
        onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
        onFocus={() => setHover(n.id)}
        onBlur={() => setHover((h) => (h === n.id ? null : h))}
        onClick={(e) => {
          e.stopPropagation();
          // Always select — toggle left panel closed with focus set (two clicks).
          select(n.id, e.shiftKey || e.metaKey);
        }}
        {...enter}
      >
        {cardBody(n)}
      </motion.button>
    );
  };

  const loose = (col: number) =>
    nodes.filter((n) => n.col === col && !n.group).sort((a, b) => a.row - b.row);

  return (
    <motion.div className="sh-diagram" initial="hidden" animate="show">
      {header}

      <motion.div
        key="canvas"
        className={`sh-diagram__canvas${(hoverOnly ? active : focus) ? " is-focused" : ""}`}
        ref={canvasRef}
        aria-label="Repository map"
        onClick={hoverOnly ? undefined : () => select(null)}
      >
        {/* Everything measured lives in this layer, so scaling it keeps the
            cards, arrows and captions in one coordinate space. */}
        <div
          className="sh-diagram__scale"
          style={fit < 1 ? { transform: `scale(${fit})` } : undefined}
        >
        <svg
          className="sh-diagram__edges"
          viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
          aria-hidden
        >
          <defs>
            {/* Separate markers rather than one: a marker paints in its own
                context, so `currentColor` inside it would not follow the
                stroke of the path that references it. `userSpaceOnUse` keeps
                the head a fixed size — scaled to a 1.25px stroke it would be
                all but invisible. The `-back-` pair points the other way, for
                edges routed against the flow. */}
            {[arrowId, arrowLitId, arrowBackId, arrowBackLitId].map((id) => {
              const back = id === arrowBackId || id === arrowBackLitId;
              return (
                <marker
                  key={id}
                  id={id}
                  markerUnits="userSpaceOnUse"
                  markerWidth="9"
                  markerHeight="7"
                  refX={back ? 1 : 8}
                  refY="3.5"
                  orient={back ? "auto-start-reverse" : "auto"}
                >
                  <path
                    className={`sh-diagram__arrow${
                      id === arrowLitId || id === arrowBackLitId ? " is-lit" : ""
                    }`}
                    d="M0 0 L9 3.5 L0 7 Z"
                  />
                </marker>
              );
            })}
          </defs>

          {edges.map((e) => {
            const route = routes[edgeKey(e)] ?? null;
            const a = byId[e.from];
            const b = byId[e.to];
            if (!route || !a || !b) return null;
            const lit = active !== null && (e.from === active || e.to === active);
            const dim = active !== null && !lit;
            const head = e.back
              ? { markerStart: `url(#${lit ? arrowBackLitId : arrowBackId})` }
              : { markerEnd: `url(#${lit ? arrowLitId : arrowId})` };
            return (
              <g key={edgeKey(e)}>
              <motion.path
                className={`sh-diagram__edge${lit ? " is-lit" : ""}${dim ? " is-dim" : ""}${
                  e.back ? " is-back" : ""
                }`}
                d={route.d}
                fill="none"
                {...head}
                // Fade with pathLength — markers sit at the geometric end immediately.
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  duration: reduced ? 0 : 0.35,
                  delay: d(Math.max(nodeDelay(a), nodeDelay(b)) + 0.15),
                }}
              />
              {/* Light streaming down the wire while its card is hovered. A
                  separate path because motion owns the base path's dash
                  attributes for the draw-in. */}
              {lit && !reduced && (
                <path
                  className={`sh-diagram__edge-flow${e.back ? " is-back" : ""}`}
                  d={route.d}
                  fill="none"
                />
              )}
              </g>
            );
          })}
        </svg>

        <div className="sh-diagram__flow">
          <div className="sh-diagram__col">{loose(0).map(renderNode)}</div>

          <div className="sh-diagram__col">
            {groups.map((g) => (
              <motion.div
                key={g.id}
                className="sh-diagram__group"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...spring, delay: d(colDelay(g.col)) }}
              >
                <div className="sh-diagram__group-title">
                  {g.title}
                  <span>{g.hint}</span>
                </div>
                <div className="sh-diagram__group-body">
                  {nodes
                    .filter((n) => n.group === g.id)
                    .sort((a, b) => a.row - b.row)
                    .map(renderNode)}
                </div>
              </motion.div>
            ))}
            {loose(1).map(renderNode)}
          </div>

          <div className="sh-diagram__col">{loose(2).map(renderNode)}</div>
        </div>

        {/* Captions ride as HTML, not <foreignObject>: they need the same
            type rendering as the cards they sit between. */}
        {edges.map((e) => {
          const route = routes[edgeKey(e)] ?? null;
          const a = byId[e.from];
          const b = byId[e.to];
          if (!route || !a || !b || !e.label) return null;
          const lit = active !== null && (e.from === active || e.to === active);
          const dim = active !== null && !lit;
          if (labelsOnHover && !lit) return null;
          return (
            <motion.span
              key={`l-${edgeKey(e)}`}
              className={`sh-diagram__edge-label${lit ? " is-lit" : ""}${dim ? " is-dim" : ""}`}
              style={{
                left: route.mid.x,
                top: route.mid.y,
                // Centring in style — Motion owns transform.
                x: "-50%",
                y: "-50%",
              }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                ...spring,
                delay: d(Math.max(nodeDelay(a), nodeDelay(b)) + 0.45),
              }}
            >
              {e.label}
            </motion.span>
          );
        })}
        </div>
      </motion.div>

      {overlay}

      <motion.footer
        className="sh-diagram__legend"
        variants={rise}
        transition={{ ...spring, delay: d(1.5) }}
      >
        <span>
          <i className="sh-diagram__dot sh-diagram__dot--frontend" /> Screens
        </span>
        <span>
          <i className="sh-diagram__dot sh-diagram__dot--backend" /> Logic
        </span>
        <span>
          <i className="sh-diagram__dot sh-diagram__dot--service" /> Security
        </span>
        <span>
          <i className="sh-diagram__dot sh-diagram__dot--data" /> Storage
        </span>
        <span className="sh-diagram__legend-note">
          {legendNote ??
            (hoverOnly
              ? "Hover a card to trace its wiring"
              : "Hover a card to trace its wiring — tap to open it live")}
        </span>
      </motion.footer>
    </motion.div>
  );
}
