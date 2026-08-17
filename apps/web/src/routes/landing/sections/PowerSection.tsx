import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { inView, rise, stagger } from "../../../shared/motion";
import { copy, diagramNodes, MONITOR_DEMO_SPANS } from "../data";
import { ASK_HINTS, IMPLEMENT_HINTS, TheaterPanel } from "../theater";
import { PENCIL_INK, RepoMapDiagram, RepoWindowHeader, WindowChrome } from "../primitives";

/** Instant marketing preview + Terra chat (Ask / Implement — no live iframe). */
function OpsPreview({
  chatHints,
  designMode = false,
  demoReplica,
}: {
  chatHints?: readonly string[];
  designMode?: boolean;
  demoReplica: "home" | "explore";
}) {
  const web = diagramNodes.find((n) => n.id === "web")!;
  return (
    <TheaterPanel
      node={web}
      onClose={() => {}}
      className="sh-theater__panel--inline"
      chatHints={chatHints}
      designMode={designMode}
      demoReplica={demoReplica}
    />
  );
}

/** Hardcoded live-traffic mock for Monitor (no /traces). */
function MonitorDemo() {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setTick((n) => n + 1), 1200);
    return () => clearInterval(id);
  }, [reduced]);

  const visible = MONITOR_DEMO_SPANS.slice(0, Math.min(6, 3 + (tick % 4)));
  const pulseIdx = tick % visible.length;
  const hot = diagramNodes[tick % diagramNodes.length];

  return (
    <div className="sh-monitor">
      <header className="sh-monitor__head">
        <span className="sh-monitor__live" aria-hidden />
        <b>Live on the map</b>
        <em>usememos/memos</em>
      </header>
      <div className="sh-monitor__body">
        <ul className="sh-monitor__nodes" aria-label="Active components">
          {diagramNodes.map((n) => (
            <li
              key={n.id}
              className={`sh-monitor__node${hot.id === n.id ? " is-hot" : ""}`}
            >
              <span className="sh-monitor__dot" aria-hidden />
              {n.label}
            </li>
          ))}
        </ul>
        <div className="sh-monitor__feed" aria-live="polite">
          <span className="sh-monitor__feed-label">Recent calls</span>
          <ul>
            {visible.map((span, i) => (
              <li
                key={`${span.method}-${span.path}-${i}`}
                className={`sh-monitor__row${i === pulseIdx ? " is-pulse" : ""}`}
              >
                <code className="sh-monitor__method">{span.method}</code>
                <code className="sh-monitor__path">{span.path}</code>
                <span className="sh-monitor__status">{span.status}</span>
                <span className="sh-monitor__comp">{span.component}</span>
                <span className="sh-monitor__ms">{span.ms}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

type OpsTabId = (typeof copy.ops)[number]["id"] | "map";

const OPS_TABS: { id: OpsTabId; label: string }[] = [
  ...copy.ops.map((o) => ({ id: o.id as OpsTabId, label: o.label })),
  { id: "map", label: "Map" },
];

/** Tabbed ops screen for Power of Terra. */
function OpsStage({
  active,
  mounted,
  caption = true,
}: {
  active: OpsTabId;
  mounted: ReadonlySet<OpsTabId>;
  caption?: boolean;
}) {
  const op = copy.ops.find((o) => o.id === active);

  const pane = (id: OpsTabId, node: ReactNode) =>
    mounted.has(id) ? (
      <div
        key={id}
        className={`sh-ops__pane${active === id ? " is-active" : ""}`}
        aria-hidden={active !== id}
        // Keep panes mounted when inactive so tab switches stay instant.
        inert={active !== id ? true : undefined}
      >
        {node}
      </div>
    ) : null;

  return (
    <motion.div className="sh-ops" variants={rise}>
      <div className="sh-ops__frame">
        <div className="sh-ops__state">
          {pane("ask", <OpsPreview chatHints={ASK_HINTS} demoReplica="home" />)}
          {pane(
            "implement",
            <OpsPreview chatHints={IMPLEMENT_HINTS} designMode demoReplica="explore" />,
          )}
          {pane("map", <RepoMapDiagram hoverOnly showHeader={false} />)}
          {pane("monitor", <MonitorDemo />)}
        </div>
      </div>
      {caption && op && (
        <p className="sh-ops__caption" key={op.id}>
          {op.caption}
        </p>
      )}
    </motion.div>
  );
}

/** Pencil curl from the Power title toward the ops tabs. */
function TryItNote() {
  const reduced = useReducedMotion();
  const d =
    "M 24 30 C 74 14, 124 36, 120 78" +
    " C 116 116, 68 122, 62 94" +
    " C 57 70, 98 62, 112 94" +
    " C 132 140, 112 226, 52 300";
  const head = "M 78 286 L 51 302 L 47 268";
  const stroke = { fill: "none", stroke: PENCIL_INK, strokeLinecap: "round" } as const;
  const draw = reduced
    ? {}
    : {
        initial: { pathLength: 0 },
        whileInView: { pathLength: 1 },
        viewport: { once: true, amount: 0.6 },
        transition: { duration: 1.1, ease: "easeInOut" as const },
      };
  return (
    <svg className="sh-tryit" viewBox="0 0 176 320" aria-hidden overflow="visible">
      <g filter="url(#sh-pencil)" opacity={0.72}>
        <motion.path d={d} {...stroke} strokeWidth={2.4} {...draw} />
        <motion.path
          d={head}
          {...stroke}
          strokeWidth={2.2}
          {...draw}
          transition={{ ...draw.transition, delay: 0.9, duration: 0.3 }}
        />
        <text className="sh-tryit__word" x="4" y="16" transform="rotate(-7 4 16)">
          Try it
        </text>
      </g>
    </svg>
  );
}

export function PowerSection() {
  const [active, setActive] = useState<OpsTabId>("ask");
  // Keep-alive: once a tab has been opened, leave its tree mounted. Starts
  // empty so we don't pay for Ask/Implement replicas until the section is near.
  const [mounted, setMounted] = useState<ReadonlySet<OpsTabId>>(() => new Set<OpsTabId>());
  const sectionRef = useRef<HTMLElement | null>(null);

  const selectTab = (id: OpsTabId) => {
    setActive(id);
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setMounted((prev) => (prev.has("ask") ? prev : new Set(prev).add("ask")));
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <motion.section
      ref={sectionRef}
      className="sh-section"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      <div className="sh-copy sh-copy--section" style={{ position: "relative" }}>
        <motion.h3 className="sh-section-title sh-section-title--note" variants={rise}>
          {copy.powerTitle}
          <TryItNote />
        </motion.h3>
        <motion.p className="sh-p1" variants={rise}>
          {copy.power}
        </motion.p>
      </div>

      <div className="sh-stage sh-stage--power">
        <motion.div className="sh-window-wrap" variants={rise}>
          <div className="sh-power-theater">
            <img
              className="sh-power-theater__wallpaper"
              src="/images/theater/power-wallpaper.jpg"
              alt=""
              aria-hidden
              draggable={false}
            />
            <div className="sh-power-theater__screen">
              <WindowChrome toolbar={false}>
                <div className="sh-window-body">
                  <motion.div
                    className="sh-diagram sh-power-ops"
                    initial="hidden"
                    animate="show"
                  >
                    <RepoWindowHeader />
                    <OpsStage active={active} mounted={mounted} caption={false} />
                  </motion.div>
                </div>
              </WindowChrome>
            </div>
            {/* Tab bar sits on the wallpaper strip below the product screen. */}
            <div
              className="sh-ops__tabs sh-power-theater__tabs"
              role="tablist"
              aria-label="Terra operations"
            >
              {OPS_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active === t.id}
                  className={`sh-ops__tab${active === t.id ? " is-active" : ""}`}
                  onClick={() => selectTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}

/* ---------- Terra playground (last screen) ---------- */
