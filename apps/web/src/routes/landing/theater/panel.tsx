import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type * as React from "react";
import { motion } from "motion/react";
import { MAX_SELECTIONS } from "../../../shared/limits";
import {
  LiveFrame,
  liveSelectionId,
  selectionLabel,
  type LiveSelection,
} from "../../../features/preview";
import { useFloatingDrag } from "../../../shared/live";
import { ask as askServer } from "../../../features/ask";
import { spring } from "../../../shared/motion";
import { LIVE_NODE_ID, REPO_URL, type DiagramNode } from "../data";
import { MemosExploreReplica, MemosHomeReplica, REPLICAS } from "./replicas";
import {
  ASK_HINTS,
  IMPLEMENT_HINTS,
  DEMO_ASK_FALLBACK,
  DEMO_ASK_REPLIES,
  TerraChatDock,
  type ChatMessage,
  type ChatScriptHandle,
} from "./chat";

type Picked = { id: string; label: string; sel?: LiveSelection };
/* ---------- scripted transforms ---------- */

const TRANSFORMS: { match: RegExp; cls: string; reply: string }[] = [
  { match: /space|spacing|padding|room|breath|air|cramped/i, cls: "tf-space", reply: "Added breathing room — padding widened, gap opened up." },
  { match: /colou?r|accent|bright|pop|yellow|brand/i, cls: "tf-accent", reply: "Pulled the brand yellow in as an accent." },
  { match: /hover|interact|click|button|feel/i, cls: "tf-hover", reply: "Added a hover lift and press state." },
  { match: /font|type|text|read|big|legib/i, cls: "tf-type", reply: "Bumped the type scale — heading now set in Fraunces." },
  { match: /round|corner|soft|edge/i, cls: "tf-round", reply: "Softened the corners." },
];
const DEFAULT_TF = { cls: "tf-polish", reply: "Tidied spacing, softened the shadow, rounded the corners." };
/* ---------- theater panel ---------- */

/** Imperative panel controls for the scripted hero film. */
export type TheaterScriptHandle = {
  /** Element for a `data-sel` key inside the replica stage. */
  getSelEl(key: string): HTMLElement | null;
  hoverSel(key: string | null): void;
  selectSel(key: string): void;
  /** Runs the existing transform table; returns Terra's reply line. */
  applyTransform(query: string): string;
  chat: ChatScriptHandle | null;
};

/** Inline theater panel (inspect mode). */
export function TheaterPanel({
  node,
  onClose,
  className = "",
  chatHints,
  designMode = false,
  /** Marketing Power tabs: static Memos UI, no LiveFrame. */
  demoReplica,
  scripted = false,
  scriptRef,
  initialMessages,
  hideDock = false,
}: {
  node: DiagramNode;
  onClose: () => void;
  className?: string;
  chatHints?: readonly string[];
  designMode?: boolean;
  demoReplica?: "home" | "explore";
  /** Scripted hero film: page-level listeners off, controls via `scriptRef`. */
  scripted?: boolean;
  scriptRef?: Ref<TheaterScriptHandle>;
  initialMessages?: ChatMessage[];
  /** Chat lives elsewhere (workspace dock column) — skip the floating dock. */
  hideDock?: boolean;
}) {
  const [selected, setSelected] = useState<Picked[]>([]);
  const selectedEls = useRef<HTMLElement[]>([]);
  const hoverEl = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const appliedTf = useRef(new Map<string, Set<string>>());
  const chatScriptRef = useRef<ChatScriptHandle | null>(null);
  const { shellRef, onHeadPointerDown, onPointerMove, endGesture } = useFloatingDrag(panelRef);
  const live = node.id === LIVE_NODE_ID && !demoReplica;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (!scripted) window.addEventListener("keydown", onKey);
    return () => {
      if (!scripted) window.removeEventListener("keydown", onKey);
      hoverEl.current?.classList.remove("is-hover");
      hoverEl.current = null;
    };
  }, [onClose, scripted]);

  const clearHover = () => {
    hoverEl.current?.classList.remove("is-hover");
    hoverEl.current = null;
  };

  const setHover = (el: HTMLElement | null) => {
    if (el === hoverEl.current) return;
    hoverEl.current?.classList.remove("is-hover");
    hoverEl.current = el;
    el?.classList.add("is-hover");
  };

  /** Deepest [data-sel] under the pointer (ignores nested ancestors). */
  const hitSelectable = (clientX: number, clientY: number): HTMLElement | null => {
    const root = stageRef.current;
    if (!root) return null;
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const node of stack) {
      if (!(node instanceof HTMLElement)) continue;
      if (!root.contains(node)) continue;
      if (node.classList.contains("sh-replica") || node === root) continue;
      const hit = node.closest<HTMLElement>("[data-sel]");
      if (hit && root.contains(hit)) return hit;
    }
    return null;
  };

  const onReplicaPointerMove = (e: React.PointerEvent) => {
    setHover(hitSelectable(e.clientX, e.clientY));
  };

  const clearSelection = () => {
    for (const el of selectedEls.current) el.classList.remove("is-selected");
    selectedEls.current = [];
    setSelected([]);
    frameRef.current?.contentWindow?.postMessage({ type: "terra:clear-selection" }, "*");
  };

  useEffect(() => {
    if (!live) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as LiveSelection & { type?: string; items?: LiveSelection[] };
      if (d?.type !== "terra:selection") return;
      const items = Array.isArray(d.items) ? d.items : d.name || d.tag ? [d] : [];
      setSelected(
        items.map((item) => {
          const label = selectionLabel(item);
          return { id: liveSelectionId(item), label, sel: item };
        }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [live]);

  useEffect(() => {
    if (scripted) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.closest(
          "iframe.sh-live, .sh-replica--live, .sh-replica:not(.sh-replica--live), .sh-theater__dock, .sh-theater__chrome",
        )
      ) {
        return;
      }
      clearSelection();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [scripted]);

  const pickEl = (el: HTMLElement | null) => {
    if (!el) {
      clearSelection();
      return;
    }
    const id = el.dataset.sel!;
    const label = el.dataset.selLabel ?? id;
    const existing = selectedEls.current.indexOf(el);
    if (existing >= 0) {
      el.classList.remove("is-selected");
      selectedEls.current = selectedEls.current.filter((n) => n !== el);
      setSelected((prev) => prev.filter((p) => p.id !== id));
      return;
    }
    let droppedId: string | null = null;
    if (selectedEls.current.length >= MAX_SELECTIONS) {
      const oldest = selectedEls.current.shift();
      droppedId = oldest?.dataset.sel ?? null;
      oldest?.classList.remove("is-selected");
    }
    el.classList.add("is-selected");
    selectedEls.current = [...selectedEls.current, el];
    setSelected((prev) => {
      const next = prev.filter((p) => p.id !== id && p.id !== droppedId);
      return [...next.slice(0, MAX_SELECTIONS - 1), { id, label }];
    });
  };

  const pick = (e: React.MouseEvent) => pickEl(hitSelectable(e.clientX, e.clientY));

  const applyDesignTransform = (q: string) => {
    const tf = TRANSFORMS.find((t) => t.match.test(q)) ?? DEFAULT_TF;
    // Key off the raw elements, not `selected` state: the scripted film calls
    // select + transform in one tick, before the state commit lands.
    const pickedIds = selectedEls.current.map((el) => el.dataset.sel!);
    const selKey = pickedIds.length > 0 ? pickedIds.join(",") : "__none__";
    let used = appliedTf.current.get(selKey);
    if (!used) {
      used = new Set();
      appliedTf.current.set(selKey, used);
    }
    if (used.has(tf.cls)) {
      return "That tweak is already on this component — pick another design change.";
    }
    if (selKey === "__none__") {
      return "Select a component in the preview first, then choose a design change.";
    }
    used.add(tf.cls);
    for (const el of selectedEls.current) {
      el.classList.add(tf.cls, "tf-pulse");
      setTimeout(() => el.classList.remove("tf-pulse"), 650);
    }
    frameRef.current?.contentWindow?.postMessage(
      { type: "terra:transform", cls: tf.cls },
      "*",
    );
    return tf.reply;
  };

  const getSelEl = (key: string) =>
    stageRef.current?.querySelector<HTMLElement>(`[data-sel="${key}"]`) ?? null;

  // Recreated every render so the closures never go stale.
  useImperativeHandle(scriptRef, () => ({
    getSelEl,
    hoverSel: (key: string | null) => setHover(key ? getSelEl(key) : null),
    selectSel: (key: string) => pickEl(getSelEl(key)),
    applyTransform: applyDesignTransform,
    get chat() {
      return chatScriptRef.current;
    },
  }));

  const demoAskReply = (q: string) => {
    const hit = ASK_HINTS.find((h) => h === q);
    return hit ? DEMO_ASK_REPLIES[hit] : DEMO_ASK_FALLBACK;
  };

  const ask = async (q: string) => {
    if (designMode) {
      await new Promise((done) => setTimeout(done, 1100));
      return applyDesignTransform(q);
    }
    // Marketing Power Ask: static home replica + canned answers (no /preview or /ask).
    if (demoReplica) {
      await new Promise((done) => setTimeout(done, 2200));
      return demoAskReply(q);
    }
    if (live) {
      const sels = selected.map((s) => s.sel).filter(Boolean) as LiveSelection[];
      return askServer(REPO_URL, q, sels);
    }
    await new Promise((done) => setTimeout(done, 900));
    return applyDesignTransform(q);
  };

  const selectionKey = selected.length ? selected.map((s) => s.id).join(",") : null;
  const crumb =
    selected.length > 0 ? `${node.label} › ${selected.map((s) => s.label).join(", ")}` : null;

  const replica =
    demoReplica === "home"
      ? () => <MemosHomeReplica />
      : demoReplica === "explore"
        ? () => <MemosExploreReplica />
        : REPLICAS[node.id];

  return (
    <motion.div
      ref={panelRef}
      className={`sh-theater__panel ${className}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      transition={spring}
    >
      <div className="sh-theater__stage" ref={stageRef}>
        {live ? (
          <div className="sh-replica sh-replica--live" data-node={node.id}>
            <LiveFrame picking frameRef={frameRef} repoUrl={REPO_URL} />
          </div>
        ) : (
          <div
            className={`sh-replica${demoReplica ? " sh-replica--explore" : ""}`}
            data-node={node.id}
            onClick={pick}
            onPointerMove={onReplicaPointerMove}
            onPointerLeave={clearHover}
          >
            {replica ? replica() : <p>No demo for this component yet.</p>}
          </div>
        )}
      </div>

      {/* Implement screen carries no hint pill — the redesign speaks for itself. */}
      {!designMode && scripted && (
        <div className="sh-theater__chrome">
          <span className="sh-chip sh-theater__label">
            <span className="sh-chip__mark" />
            {demoReplica ? "Memos" : node.label}
            <span className="sh-theater__hint">Terra picks a component and redesigns it</span>
          </span>
        </div>
      )}

      {!hideDock && (
        <div
          ref={shellRef}
          className="sh-theater__dock"
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          <TerraChatDock
            selectionKey={selectionKey}
            crumb={crumb}
            onAsk={ask}
            onHeadPointerDown={onHeadPointerDown}
            hints={chatHints ?? (designMode ? IMPLEMENT_HINTS : ASK_HINTS)}
            designMode={designMode}
            scripted={scripted}
            scriptRef={chatScriptRef}
            initialMessages={initialMessages}
          />
        </div>
      )}
    </motion.div>
  );
}
