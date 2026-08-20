import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { inView, rise, stagger } from "../../../shared/motion";
import { copy, diagramNodes, MONITOR_DEMO_SPANS } from "../data";
import { ASK_HINTS, IMPLEMENT_HINTS, TheaterPanel } from "../theater";
import { PENCIL_INK, RepoMapDiagram, RepoWindowHeader, WindowChrome } from "../primitives";
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

/** Left capability list — active expands caption; inactive stay slightly blurred. */
function OpsCapabilityList({
  active,
  onSelect,
}: {
  active: OpsTabId;
  onSelect: (id: OpsTabId) => void;
}) {
  const reduced = useReducedMotion();

  return (
    <div className="sh-power-list" role="tablist" aria-label="Terra operations">
      {OPS_ITEMS.map((item) => {
        const isActive = active === item.id;
        return (
          <div
            key={item.id}
            className={`sh-power-list__item${isActive ? " is-active" : ""}`}
          >
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
            <AnimatePresence initial={false}>
              {isActive && (
                <motion.p
                  key={item.id}
                  className="sh-power-list__caption"
                  initial={reduced ? false : { height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={reduced ? undefined : { height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                >
                  <span>{item.caption}</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** "The Power of Terra" sketched into the blank gap above the section. */
const GAP_TITLE_WORDS = ["The", "Power", "of", "Terra"];

function GapTitle() {
  const reduced = useReducedMotion();
  return (
    <div className="sh-power-gap-title" aria-hidden>
      {GAP_TITLE_WORDS.map((word, i) => (
        <motion.span
          key={word}
          className="sh-power-gap-title__word"
          // Fills in left-to-right like the curl draws — never `y`/`opacity`,
          // which would overwrite the staircase transform the CSS sets.
          initial={reduced ? false : { clipPath: "inset(0% 100% 0% 0%)" }}
          whileInView={{ clipPath: "inset(0% 0% 0% 0%)" }}
          // Default `amount` only: the gap title overflows the section box, so
          // its intersection ratio never reaches a fractional threshold.
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: "easeOut", delay: i * 0.22 }}
        >
          {word}
        </motion.span>
      ))}
    </div>
  );
}

/** Hand-drawn "Try it yourself" note that drops onto the demo card's top edge. */
/* Drops from under the words on the right, loops once, then descends into the
   card — so the arrow lands pointing down at the top edge, not sideways. */
const NOTE_CURL_D =
  "M 158 4 C 176 46, 150 78, 140 104" +
  " C 132 126, 106 142, 96 128 C 88 116, 108 100, 122 114" +
  " C 140 132, 122 176, 94 206 C 91 210, 89 216, 88 224";

/** Seconds the curl takes to draw itself once the note scrolls into view. */
const NOTE_DRAW_S = 1.7;

function TryItNote() {
  const reduced = useReducedMotion();
  // Draws once when the note comes into view — the pencil writes, it doesn't pop.
  const draw = reduced
    ? {}
    : {
        initial: { pathLength: 0 },
        whileInView: { pathLength: 1 },
        viewport: { once: true, amount: 0.6 },
      };

  return (
    <div className="sh-power-note" aria-hidden>
      <motion.span
        className="sh-power-note__text"
        initial={reduced ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 0.5 }}
      >
        Try it yourself
      </motion.span>
      <svg className="sh-power-note__line" viewBox="0 0 200 230" fill="none">
        <g filter="url(#sh-pencil)" stroke={PENCIL_INK} strokeLinecap="round" fill="none">
          <motion.path
            d={NOTE_CURL_D}
            strokeWidth={3.4}
            opacity={0.72}
            {...draw}
            transition={{ duration: NOTE_DRAW_S, ease: "easeInOut", delay: 0.25 }}
          />
          <motion.path
            d={NOTE_CURL_D}
            strokeWidth={7}
            opacity={0.12}
            {...draw}
            transition={{ duration: NOTE_DRAW_S, ease: "easeInOut", delay: 0.25 }}
          />
          {/* Arrowhead lands only once the line has reached the card. */}
          <motion.path
            d="M 72 206 L 88 227 L 104 208"
            strokeWidth={3.4}
            initial={reduced ? false : { opacity: 0 }}
            whileInView={{ opacity: 0.7 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.3, delay: NOTE_DRAW_S }}
          />
        </g>
      </svg>
    </div>
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
      className="sh-section sh-section--power"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      <div className="sh-stage sh-stage--power">
        <motion.div className="sh-power-stage" variants={rise}>
          <GapTitle />
          <div className="sh-power-rail">
            {/* No headline — the capability list is the section's own title. */}
            <h3 className="sh-sr-only">{copy.powerTitle}</h3>
            <OpsCapabilityList active={active} onSelect={selectTab} />
          </div>
          <div className="sh-window-wrap">
            <TryItNote />
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
