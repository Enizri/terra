import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { inView, rise, stagger } from "../../../shared/motion";
import { copy, diagramNodes, MONITOR_DEMO_SPANS } from "../data";
import { ASK_HINTS, IMPLEMENT_HINTS, TheaterPanel } from "../theater";
import {
  CircleArrowIcon,
  MotionLink,
  RepoMapDiagram,
  RepoWindowHeader,
  TerraMark,
  WindowChrome,
} from "../primitives";
import { PlaygroundStage } from "./PlaygroundStage";

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
        <em>terra/terra</em>
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

type OpsTabId = (typeof copy.ops)[number]["id"];

const OPS_ITEMS = copy.ops;

/** Tabbed ops screen for Power of Terra. */
function OpsStage({
  active,
  mounted,
}: {
  active: OpsTabId;
  mounted: ReadonlySet<OpsTabId>;
}) {
  const pane = (id: OpsTabId, node: ReactNode) =>
    mounted.has(id) ? (
      <div
        key={id}
        id={`power-pane-${id}`}
        role="tabpanel"
        aria-labelledby={`power-tab-${id}`}
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
          {pane("collaborate", <PlaygroundStage />)}
        </div>
      </div>
    </motion.div>
  );
}

/** Left capability drawer — rows separated by rules; the active row goes from
 *  grey to ink and unrolls its caption. The reveal is CSS-only: a `0fr -> 1fr`
 *  grid row animates height without measuring, so the caption can play in both
 *  directions instead of being torn down by an exit animation. */
function OpsCapabilityList({
  active,
  onSelect,
}: {
  active: OpsTabId;
  onSelect: (id: OpsTabId) => void;
}) {
  return (
    <ul className="sh-power-list" role="tablist" aria-label="Terra operations">
      {OPS_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <li
            key={item.id}
            // `tablist` children must be tabs; the row is scaffolding.
            role="presentation"
            className={`sh-power-list__item${isActive ? " is-active" : ""}`}
          >
            {/* Marker lives inside its own row rather than being offset from
                the top of the list — a wrapped label can't desync it. */}
            <TerraMark className="sh-power-list__mark" />
            <button
              type="button"
              id={`power-tab-${item.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`power-pane-${item.id}`}
              className="sh-power-list__btn"
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
            <div className="sh-power-list__reveal">
              <div className="sh-power-list__reveal-inner">
                <p className="sh-power-list__caption">{item.caption}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
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
      // The hero's secondary CTA targets `#power`.
      id="power"
      className="sh-section sh-section--power"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      <div className="sh-stage sh-stage--power">
        <motion.div className="sh-power-stage" variants={rise}>
          <div className="sh-power-rail">
            <OpsCapabilityList active={active} onSelect={selectTab} />
            <MotionLink className="sh-power-cta" to="/new" whileTap={{ scale: 0.98 }}>
              Try Terra
              <CircleArrowIcon />
            </MotionLink>
          </div>
          <div className="sh-window-wrap">
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
                      <OpsStage active={active} mounted={mounted} />
                    </motion.div>
                  </div>
                </WindowChrome>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.section>
  );
}
