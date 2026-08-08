import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { inView, rise, stagger } from "../../../shared/motion";
import { copy, diagramNodes } from "../data";
import { IMPLEMENT_HINTS, TheaterPanel } from "../theater";
import { PENCIL_INK, RepoMapDiagram, RepoWindowHeader, WindowChrome } from "../primitives";

/** Preview + Terra chat for Ask / Implement ops tabs. */
function OpsPreview({
  chatHints,
  designMode = false,
  exploreReplica = false,
}: {
  chatHints?: readonly string[];
  designMode?: boolean;
  /** Implement: clickable Memos explore UI (not the live Ask iframe). */
  exploreReplica?: boolean;
}) {
  const web = diagramNodes.find((n) => n.id === "web")!;
  return (
    <TheaterPanel
      node={web}
      onClose={() => {}}
      className="sh-theater__panel--inline"
      chatHints={chatHints}
      designMode={designMode}
      exploreReplica={exploreReplica}
    />
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
        // Keep the live iframe in the tree when inactive — unmounting it
        // re-hits /preview and shows "Starting the dev server…" again.
        inert={active !== id ? true : undefined}
      >
        {node}
      </div>
    ) : null;

  return (
    <motion.div className="sh-ops" variants={rise}>
      <div className="sh-ops__frame">
        <div className="sh-ops__state">
          {pane("ask", <OpsPreview />)}
          {pane(
            "implement",
            <OpsPreview chatHints={IMPLEMENT_HINTS} designMode exploreReplica />,
          )}
          {pane("map", <RepoMapDiagram hoverOnly showHeader={false} />)}
          {pane(
            "monitor",
            <div className="sh-opstate sh-opstate--soon">
              <p>
                {copy.ops.find((o) => o.id === "monitor")?.caption}
              </p>
              <span className="sh-opstate__pill">Demo coming soon</span>
            </div>,
          )}
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
  // empty — the ask pane boots a real dev-server preview (POST /preview), so
  // don't spend that on visitors who never scroll here.
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
