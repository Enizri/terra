import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Alignment, Fit, Layout, useRive } from "@rive-app/react-canvas";
import { useReveal } from "../hooks/useReveal";
import { heroContent as hero } from "../heroContent";
import styles from "./Transform.module.css";

// Invented pseudo-code for the "raw repo" pane — decorative only.
const CODE_LINES = [
  "func (s *APIService) CreateMemo(ctx context.Context, req *Request) {",
  "  if err := s.authz.Check(ctx, req.User); err != nil {",
  "    return nil, status.Error(codes.PermissionDenied, err.Error())",
  "  }",
  "  payload, err := markdown.Parse(req.Content)",
  "  const useMemoStore = create<MemoState>((set) => ({",
  "    memos: [], loading: false,",
  "    fetch: async (filter) => { ... },",
  "  }))",
  "  row := s.store.Upsert(ctx, &store.Memo{Payload: payload})",
  "  export function MemoEditor({ onSave }: Props) {",
  "    const [content, setContent] = useState(\"\")",
  "  webhook.Dispatch(ctx, event.MemoCreated, row)",
  "  CREATE TABLE memo (id INTEGER PRIMARY KEY, ...)",
  "  return &Response{Memo: row.Proto()}, nil",
  "}",
  "class AttachmentWorker:",
  "    def presign(self, key: str) -> str:",
  "        return self.s3.generate_url(key, ttl=3600)",
  "SELECT * FROM memo WHERE creator_id = ? ORDER BY ts DESC",
  "message MemoService { rpc CreateMemo(...) returns (...); }",
  "func (d *Driver) Migrate(ctx context.Context) error {",
];

const NODES = [
  { x: 130, y: 12, w: 110, label: "Web App", c: "#e0567f" },
  { x: 130, y: 74, w: 110, label: "API Layer", c: "#ffc53d" },
  { x: 10, y: 74, w: 84, label: "Runtime", c: "#241a10" },
  { x: 24, y: 142, w: 84, label: "Auth", c: "#ffc53d" },
  { x: 142, y: 142, w: 86, label: "Memos", c: "#ffc53d" },
  { x: 252, y: 142, w: 104, label: "Attachments", c: "#ffc53d" },
  { x: 130, y: 208, w: 110, label: "Data Storage", c: "#e0567f" },
];

const LINKS: [number, number, number, number][] = [
  [185, 42, 185, 74],
  [94, 89, 130, 89],
  [160, 104, 66, 142],
  [185, 104, 185, 142],
  [212, 104, 304, 142],
  [66, 172, 150, 224],
  [185, 172, 185, 208],
  [304, 172, 240, 224],
];

const CYCLE = 9; // seconds per assemble-hold-reset loop

export default function Transform() {
  const ref = useReveal<HTMLDivElement>({ targets: "[data-reveal]", stagger: 0.15 });
  const reduced = useReducedMotion();
  const [activated, setActivated] = useState(false);
  const riveBoxRef = useRef<HTMLDivElement>(null);

  // Rive listeners only react inside the artboard, so project the mouse's
  // position across the whole split area onto the canvas rect — full-range
  // tracking over the cards included. Canvas has pointer-events: none; all
  // pointer input arrives through this synthetic dispatch.
  const forwardPointer = (e: React.MouseEvent) => {
    const cv = riveBoxRef.current?.querySelector("canvas");
    if (!cv) return;
    const area = e.currentTarget.getBoundingClientRect();
    const r = cv.getBoundingClientRect();
    const nx = (e.clientX - area.left) / area.width;
    const ny = (e.clientY - area.top) / area.height;
    const opts = {
      clientX: r.left + nx * r.width,
      clientY: r.top + ny * r.height,
    };
    // runtime version determines which event family it registered for
    cv.dispatchEvent(new PointerEvent("pointermove", opts));
    cv.dispatchEvent(new MouseEvent("mousemove", opts));
  };
  const { RiveComponent } = useRive({
    src: hero.riveSrc,
    stateMachines: hero.riveStateMachine,
    autoplay: true,
    layout: new Layout({ fit: Fit.Cover, alignment: Alignment.Center }),
  });

  // Node i pops in at its own moment of the cycle, holds, fades, repeats.
  const nodeAnim = (i: number) => {
    if (reduced) return {};
    const t = (0.6 + i * 0.35) / CYCLE;
    return {
      initial: { opacity: 0, scale: 0.85 },
      animate: { opacity: [0, 0, 1, 1, 0], scale: [0.85, 0.85, 1, 1, 0.95] },
      transition: {
        duration: CYCLE,
        times: [0, t, Math.min(t + 0.04, 0.9), 0.93, 1],
        repeat: Infinity,
        ease: "easeOut" as const,
      },
    };
  };

  const linkAnim = (i: number) => {
    if (reduced) return {};
    const t = (3.4 + i * 0.25) / CYCLE;
    return {
      initial: { pathLength: 0, opacity: 0 },
      animate: { pathLength: [0, 0, 1, 1, 0], opacity: [0, 0, 1, 1, 0] },
      transition: {
        duration: CYCLE,
        times: [0, t, Math.min(t + 0.06, 0.9), 0.93, 1],
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    };
  };

  return (
    <section id="video" className={`section ${styles.tight}`}>
      <div ref={ref} className="container">
        <div data-reveal className={styles.split} onMouseMove={forwardPointer}>
          <figure className={styles.pane}>
            <div className={`browser-frame ${styles.codeFrame}`}>
              <div className="browser-frame__bar">
                <span className="browser-frame__dot" style={{ background: "#ff7a59" }} />
                <span className="browser-frame__dot" style={{ background: "#f6c344" }} />
                <span className="browser-frame__dot" style={{ background: "#9fd8c3" }} />
                <span className="browser-frame__title">
                  usememos/memos — 1,030 files
                </span>
              </div>
              <div className={styles.codeViewport}>
                <div className={reduced ? styles.codeTrack : `${styles.codeTrack} ${styles.codeScroll}`}>
                  {[...CODE_LINES, ...CODE_LINES].map((l, i) => (
                    <pre key={i} className={styles.codeLine}>
                      {l}
                    </pre>
                  ))}
                </div>
                <div className={styles.codeFade} />
              </div>
            </div>
            <figcaption className={styles.caption}>
              What engineers see: a thousand files of Go, TypeScript and SQL.
            </figcaption>
          </figure>

          <div className={styles.arrow}>
            <div ref={riveBoxRef} className={styles.rive} aria-hidden>
              <RiveComponent />
            </div>
            <button
              type="button"
              className={activated ? styles.activateOn : styles.activate}
              onClick={() => setActivated((a) => !a)}
            >
              <span aria-hidden>✳︎</span>{" "}
              {activated ? hero.activatedLabel : hero.activateLabel}
            </button>
          </div>

          <figure
            className={styles.pane}
            style={{
              opacity: activated ? 1 : 0,
              transform: activated ? "translateX(0)" : "translateX(24px)",
              pointerEvents: activated ? "auto" : "none",
              transition: "opacity 0.45s ease, transform 0.45s ease",
            }}
            aria-hidden={!activated}
          >
            <div className={`browser-frame ${styles.mapFrame}`}>
              <div className="browser-frame__bar">
                <span className="browser-frame__dot" style={{ background: "#ff7a59" }} />
                <span className="browser-frame__dot" style={{ background: "#f6c344" }} />
                <span className="browser-frame__dot" style={{ background: "#9fd8c3" }} />
                <span className="browser-frame__title">terra · memos.map</span>
              </div>
              <svg viewBox="0 0 366 258" className={styles.mapSvg}>
                {LINKS.map(([x1, y1, x2, y2], i) => (
                  <motion.path
                    key={i}
                    d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                    stroke="#b9a88f"
                    strokeWidth="1.6"
                    fill="none"
                    {...linkAnim(i)}
                  />
                ))}
                {NODES.map((n, i) => (
                  <motion.g key={n.label} {...nodeAnim(i)}>
                    <rect
                      x={n.x}
                      y={n.y}
                      width={n.w}
                      height={30}
                      rx={8}
                      fill="#fffdf9"
                      stroke="rgba(34,26,51,.15)"
                    />
                    <rect x={n.x} y={n.y + 6} width={3} height={18} rx={1.5} fill={n.c} />
                    <text
                      x={n.x + 12}
                      y={n.y + 19}
                      fontSize="10.5"
                      fontWeight="600"
                      fill="#221a33"
                      fontFamily="Inter, sans-serif"
                    >
                      {n.label}
                    </text>
                  </motion.g>
                ))}
              </svg>
            </div>
            <figcaption className={styles.caption}>
              What your whole team sees: one map, evidence included.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
