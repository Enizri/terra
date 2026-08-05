// The hero's repo map, extracted so it renders any data — the landing's
// hand-authored flow and a real /analyze result draw with the same engine.
//
// Everything here was `RepoMapDiagram` inside TerraLanding.tsx. The only
// change is that the nodes, edges and groups arrive as props instead of being
// read off the module-level mock arrays.

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { rise, spring } from "../terra/data";
import TechIcon from "./TechIcon";

export type DiagramKind = "frontend" | "backend" | "data" | "service";

export type DiagramNodeView = {
  id: string;
  label: string;
  /** Plain-English sentence — the card's primary text. */
  purpose: string;
  /** Short evidence path, revealed only when the node is focused. */
  hint: string;
  kind: DiagramKind;
  /** Column in the left→right flow: 0 = entry, 1 = the work, 2 = storage. */
  col: 0 | 1 | 2;
  /** Order within the column (and within its group box, if grouped). */
  row: number;
  group?: string;
  /** Detected technologies — picks the card's tech tile (first match wins). */
  tech?: string[];
};

export type DiagramEdgeView = {
  from: string;
  to: string;
  label?: string;
  /** Points right→left in the flow: routed forwards, drawn with a reversed head. */
  back?: boolean;
};

export type DiagramGroupView = { id: string; title: string; hint: string; col: number };

/**
 * Deterministic assembly beats. The flow builds left→right, one column at a
 * time, so a viewer can follow a single element per beat instead of watching
 * six things ease in at once.
 */
const colDelay = (col: number) => 0.15 + col * 0.4;
const nodeDelay = (n: DiagramNodeView) => colDelay(n.col) + 0.1 + n.row * 0.08;

type EdgeRef = { from: string; to: string };
const edgeKey = (e: EdgeRef) => `${e.from}-${e.to}`;

/** Breathing room between an arrowhead and the card it points at. */
const ARROW_GAP = 6;
/** How far left of the cards a same-column detour swings. */
const DETOUR = 14;

/** Layout box of a card, in canvas-relative px. */
type Box = { x: number; y: number; w: number; h: number };

/**
 * Layout offset of `el` relative to `stop`, walking the offsetParent chain.
 *
 * Not simply `el.offsetLeft`: a transformed element becomes an offsetParent
 * for its descendants, and Motion transforms the group box on entry. That
 * silently reparents the grouped cards mid-animation, so their raw offsets are
 * measured from the group rather than the canvas. Summing the chain is correct
 * either way — and unlike getBoundingClientRect it still ignores the
 * transforms themselves, so a card measured mid-scale reports where it will
 * come to rest.
 */
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

/**
 * Orthogonal router. Three cases, because a flow diagram only ever needs
 * three: hop to the next column, step to the neighbour directly above or
 * below, or detour around a card the line must not appear to touch.
 *
 * Right→left edges are routed by swapping the ends and drawing the head at
 * the start, so this only ever sees a forward flow.
 */
function routeEdge(a: DiagramNodeView, b: DiagramNodeView, ra: Box, rb: Box): Route | null {
  // A hidden card (mobile, or before first paint) measures 0×0 and would
  // otherwise produce a path anchored at the canvas origin.
  if (!ra.w || !ra.h || !rb.w || !rb.h) return null;

  const ay = ra.y + ra.h / 2;
  const by = rb.y + rb.h / 2;
  let pts: { x: number; y: number }[];

  if (a.col !== b.col) {
    // Next column: leave the right edge, enter the left edge.
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
    // Neighbour in the same stack: a plain vertical between facing edges.
    const cx = ra.x + ra.w / 2;
    const down = b.row > a.row;
    pts = [
      { x: cx, y: down ? ra.y + ra.h : ra.y },
      { x: cx, y: down ? rb.y - ARROW_GAP : rb.y + rb.h + ARROW_GAP },
    ];
  } else {
    // Skipping a card in the same stack: swing out to the left so the line
    // never runs through a component it has nothing to do with.
    const dx = Math.min(ra.x, rb.x) - DETOUR;
    pts = [
      { x: ra.x, y: ay },
      { x: dx, y: ay },
      { x: dx, y: by },
      { x: rb.x - ARROW_GAP, y: by },
    ];
  }

  const round = (v: number) => Math.round(v * 10) / 10;
  const d = pts.map((p, i) => `${i ? "L" : "M"} ${round(p.x)} ${round(p.y)}`).join(" ");

  // The caption rides the longest segment — the only one with room for it.
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

/**
 * The repo map: a left→right flow of cards with routed orthogonal wiring.
 * Hover traces a card's neighbours and dims the rest; click selects, unless
 * `hoverOnly`.
 *
 * Selection is controlled — the owner decides what a click opens (the
 * landing's theater, the workspace's details panel).
 */
export default function RepoDiagram({
  nodes,
  edges,
  groups,
  header,
  overlay,
  hoverOnly = false,
  selectedId = null,
  onSelect,
  legendNote,
  labelsOnHover = false,
  remeasureKey,
}: {
  nodes: DiagramNodeView[];
  edges: DiagramEdgeView[];
  groups: readonly DiagramGroupView[];
  /** Rendered above the canvas — the repo title row. */
  header?: ReactNode;
  /** Covers the whole card at its full size (the landing's theater panel). */
  overlay?: ReactNode;
  hoverOnly?: boolean;
  selectedId?: string | null;
  /** `additive` is a shift/⌘-click — the owner decides whether it stacks. */
  onSelect?: (id: string | null, additive?: boolean) => void;
  legendNote?: string;
  /** Show a relationship's caption only while its edge is lit — a real map has
      an edge on nearly every card, and every caption at once is a wall. */
  labelsOnHover?: boolean;
  /** Any owner state that changes the canvas' mount or size — forces a re-measure. */
  remeasureKey?: unknown;
}) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const reduced = useReducedMotion();
  /** Hover lights the wiring; click selects unless `hoverOnly`. */
  const [hover, setHover] = useState<string | null>(null);
  const focus = hoverOnly ? null : selectedId;
  const active = hover ?? focus;

  const select = (id: string | null, additive?: boolean) => onSelect?.(id, additive);

  // Both mounts can be alive at once, so the arrowhead markers need ids that
  // don't collide — `url(#…)` would silently resolve to the other diagram's.
  const uid = useId().replace(/:/g, "");
  const arrowId = `dg-arrow-${uid}`;
  const arrowLitId = `dg-arrow-lit-${uid}`;
  const arrowBackId = `dg-arrow-back-${uid}`;
  const arrowBackLitId = `dg-arrow-back-lit-${uid}`;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeEls = useRef<Record<string, HTMLElement | null>>({});
  const [routes, setRoutes] = useState<Record<string, Route>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** Scale-to-fit: <1 when the tallest column outgrows the canvas. */
  const [fit, setFit] = useState(1);
  /** Last geometry committed, so an unchanged re-measure costs no render. */
  const lastGeom = useRef("");

  useEffect(() => {
    if (hoverOnly || !focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, hoverOnly]);

  /**
   * Arrows are measured, not guessed: the flow is plain flexbox, so only the
   * browser knows where the cards ended up.
   *
   * Positions come from `offsetLeft/offsetTop`, not `getBoundingClientRect` —
   * offsets describe layout and ignore transforms, so measuring mid-entrance
   * (while Motion holds the cards scaled and offset) still yields their final
   * resting geometry. See `offsetWithin` for why the chain has to be summed.
   *
   * `focus` stays a dependency defensively: card chrome that reacts to focus
   * and changes layout would reflow the stack without resizing the canvas, so
   * the ResizeObserver alone would sleep through it.
   */
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
        // A back edge is routed forwards and gets its head drawn at the start.
        const [fromId, toId] = e.back ? [e.to, e.from] : [e.from, e.to];
        const a = byId[fromId];
        const b = byId[toId];
        const ra = boxes[fromId];
        const rb = boxes[toId];
        if (!a || !b || !ra || !rb) continue;
        const route = routeEdge(a, b, ra, rb);
        if (route) next[edgeKey(e)] = route;
      }
      // A column taller than the canvas would be clipped top and bottom by
      // `overflow: hidden` — scale the whole content layer down to fit
      // instead. Offsets ignore transforms, so the routes stay valid: cards,
      // arrows and labels all live in the scaled layer and shrink together.
      let topY = Infinity;
      let botY = -Infinity;
      for (const el of canvas.querySelectorAll<HTMLElement>(
        ".sh-diagram__group, .sh-diagram__node",
      )) {
        const at = offsetWithin(el, canvas);
        topY = Math.min(topY, at.y);
        botY = Math.max(botY, at.y + el.offsetHeight);
      }
      const flowEl = canvas.querySelector<HTMLElement>(".sh-diagram__flow");
      const avail = flowEl?.offsetHeight ?? 0;
      const contentH = botY - topY;
      const f = avail > 0 && contentH > avail ? avail / contentH : 1;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      // Scrolling re-measures every frame; without this each one would hand
      // React a freshly allocated routes object and re-render both diagrams
      // for geometry that has not moved.
      const sig = `${w}x${h}|${JSON.stringify(next)}`;
      if (sig === lastGeom.current) return;
      lastGeom.current = sig;

      setSize({ w, h });
      setRoutes(next);
      setFit(f);
    };

    measure();
    // Observe the cards themselves, not just the canvas. The canvas keeps its
    // size while its contents settle — stylesheet injection, webfont swap, a
    // card growing to fit its sentence — and a canvas-only observer sleeps
    // through all of it, leaving every arrow anchored to a stale layout.
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    const flow = canvas.querySelector(".sh-diagram__flow");
    if (flow) ro.observe(flow);
    for (const n of nodes) {
      const el = nodeEls.current[n.id];
      if (el) ro.observe(el);
    }
    // Mono labels reflow once the webfont lands, moving every card with them.
    document.fonts?.ready.then(measure).catch(() => {});

    // The landing's windows are scroll-driven: the hero's grows as it comes in
    // and the Map section's settles into place, resizing the flow underneath.
    // That resize is driven from outside the canvas, so it does not always
    // reach the observer — without this the arrows keep the geometry they were
    // born with and point into empty canvas.
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

  // Neighbours stay lit with the focused card; everything else recedes.
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
    // Hero paste: hover owns the focus chrome. Selectable maps: click does.
    const lit = hoverOnly ? active === n.id : focus === n.id;
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
          className={`sh-diagram__node sh-diagram__node--${n.kind} sh-diagram__node--hover-only${
            lit ? " is-focus" : ""
          }${dim ? " is-dim" : ""}`}
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
        className={`sh-diagram__node sh-diagram__node--${n.kind}${lit ? " is-focus" : ""}${
          dim ? " is-dim" : ""
        }`}
        aria-pressed={focus === n.id}
        onMouseEnter={() => setHover(n.id)}
        onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
        onFocus={() => setHover(n.id)}
        onBlur={() => setHover((h) => (h === n.id ? null : h))}
        onClick={(e) => {
          e.stopPropagation();
          // Always select — a toggle here left the panel closed but focus set,
          // so reopening the same card took two clicks.
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
                // `opacity` rides along with `pathLength`: a marker is drawn
                // at the path's geometric end from the first frame, so a
                // length-only draw pops a finished arrowhead at the
                // destination before the line gets there.
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
                // Centring lives here, not in CSS: Motion owns `transform`.
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
