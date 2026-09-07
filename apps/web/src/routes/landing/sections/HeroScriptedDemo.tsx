// Hero scripted film: a fake macOS cursor drives the real workspace UI —
// drop → zoom out → scan → map → redesign chat — in a loop. Live DOM, no video.

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatScriptHandle, TheaterScriptHandle } from "../theater";
import { MacPointer } from "../primitives";
import { HeroWorkspaceShell, type FilmPhase, type WsFilmHandle } from "./HeroWorkspaceShell";

/** Also the transform query — "bigger" hits the tf-type bump in the table. */
const MSG_USER_BIGGER = "Make it look a bit bigger";
const MSG_TERRA_TYPE = "Bumped the type scale — heading now set in Fraunces.";
const MSG_TERRA_PR = "Should I open a PR with your UI changes?";
const MSG_USER_YES = "Yes";
const MSG_TERRA_DONE = "Consider it done 🙂 — PR #128 is on its way.";

const CRUMB_BOARD = "Web App › Notes board";

/** Real server pipeline copy — the scan phase replays it verbatim. */
const SCAN_LABELS = [
  "Cloning github.com/usememos/memos",
  "Read 312 files across 5 languages",
  "Terra is reading the architecture",
  "Saving 6 components",
] as const;
const SCAN_LABEL_MS = 1150;

const FINAL_CHAT: ChatMessage[] = [
  { role: "user", text: MSG_USER_BIGGER },
  { role: "terra", text: MSG_TERRA_TYPE },
  { role: "terra", text: MSG_TERRA_PR },
  { role: "user", text: MSG_USER_YES },
  { role: "terra", text: MSG_TERRA_DONE },
];

class Aborted extends Error {}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Aborted());
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Aborted());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

/** Poll for an element that mounts asynchronously (theater panel entrance). */
async function waitForEl(get: () => HTMLElement | null, signal: AbortSignal, timeout = 3000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const el = get();
    if (el) return el;
    await sleep(80, signal);
  }
  return null;
}

type CursorState = {
  x: number;
  y: number;
  /** Travel time for this move. */
  ms: number;
  pressed: boolean;
  visible: boolean;
  /** Increments per click — keys a one-shot ripple. */
  ripple: number;
};

function DemoCursor({ cursor }: { cursor: CursorState }) {
  return (
    <motion.div
      className="sh-demo-cursor"
      initial={false}
      animate={{
        x: cursor.x,
        y: cursor.y,
        opacity: cursor.visible ? 1 : 0,
        scale: cursor.pressed ? 0.82 : 1,
      }}
      transition={{
        x: { duration: cursor.ms / 1000, ease: [0.3, 0, 0.2, 1] },
        y: { duration: cursor.ms / 1000, ease: [0.3, 0, 0.2, 1] },
        opacity: { duration: 0.3 },
        scale: { duration: 0.12 },
      }}
    >
      {cursor.ripple > 0 && <i key={cursor.ripple} className="sh-demo-cursor__ripple" />}
      <MacPointer />
    </motion.div>
  );
}

/** Looping hero film: the workspace maps a repo and Terra redesigns its UI. */
export function HeroScriptedDemo({ dropped }: { dropped: boolean }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const filmRef = useRef<WsFilmHandle | null>(null);
  const theaterRef = useRef<TheaterScriptHandle | null>(null);
  const chatRef = useRef<ChatScriptHandle | null>(null);
  const [cycle, setCycle] = useState(0);
  const [phase, setPhase] = useState<FilmPhase>("scan");
  const [scanLabel, setScanLabel] = useState<string>(SCAN_LABELS[0]);
  const [elapsed, setElapsed] = useState(0);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [crumb, setCrumb] = useState<string | null>(null);
  const [cursor, setCursor] = useState<CursorState>({
    x: 0,
    y: 0,
    ms: 0,
    pressed: false,
    visible: false,
    ripple: 0,
  });
  const reduced = useReducedMotion();
  const inView = useInView(rootRef, { amount: 0.35 });

  useEffect(() => {
    if (reduced || !inView || !dropped) return;
    const ctl = new AbortController();
    const signal = ctl.signal;

    const q = (sel: string) => rootRef.current?.querySelector<HTMLElement>(sel) ?? null;

    const centerOf = (el: HTMLElement) => {
      const root = rootRef.current;
      if (!root) return null;
      const r = el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 };
    };

    const moveTo = async (el: HTMLElement | null, ms: number) => {
      const pt = el && centerOf(el);
      if (!pt) return;
      setCursor((c) => ({ ...c, x: pt.x, y: pt.y, ms }));
      await sleep(ms + 60, signal);
    };

    const click = async () => {
      setCursor((c) => ({ ...c, pressed: true, ripple: c.ripple + 1 }));
      await sleep(140, signal);
      setCursor((c) => ({ ...c, pressed: false }));
    };

    const typeText = async (text: string) => {
      for (let i = 1; i <= text.length; i++) {
        chatRef.current?.setPromptText(text.slice(0, i));
        await sleep(35, signal);
      }
    };

    const hoverStop = async (id: string, hold: number) => {
      await moveTo(q(`[data-node-id="${id}"]`), 700);
      filmRef.current?.hoverNode(id);
      await sleep(hold, signal);
      filmRef.current?.hoverNode(null);
    };

    const playOnce = async () => {
      // Beat 1 — the small drop window just expanded into the workspace
      // (Hero.tsx owns that transition); Terra clones and reads the repo.
      setPhase("scan");
      for (let i = 0; i < SCAN_LABELS.length; i++) {
        setScanLabel(SCAN_LABELS[i]);
        setElapsed(i);
        await sleep(SCAN_LABEL_MS, signal);
      }

      // Beat 4 — the map lands in the stage.
      setPhase("map");
      await sleep(1900, signal);
      const root = rootRef.current;
      if (!root) return;
      const box = root.getBoundingClientRect();
      setCursor((c) => ({ ...c, x: box.width * 0.55, y: box.height * 0.85, ms: 0, visible: true }));
      await sleep(300, signal);

      // Beat 5 — trace a couple of blocks, then select Web App (real click
      // behavior: violet focus ring), and open its live preview from the bar.
      await hoverStop("db", 900);
      await hoverStop("api", 900);
      await moveTo(q('[data-node-id="web"]'), 700);
      filmRef.current?.hoverNode("web");
      await sleep(400, signal);
      await click();
      filmRef.current?.hoverNode(null);
      filmRef.current?.selectNode("web");
      await sleep(600, signal);
      await moveTo(q('[data-film="preview-chip"]'), 700);
      await sleep(200, signal);
      await click();
      filmRef.current?.openPreview(true);

      // Beat 6 — Memos opens over the map; select the board.
      const board = await waitForEl(() => theaterRef.current?.getSelEl("board") ?? null, signal);
      if (!board) return;
      await sleep(700, signal); // panel entrance settles
      await moveTo(board, 800);
      theaterRef.current?.hoverSel("board");
      await sleep(350, signal);
      await click();
      theaterRef.current?.selectSel("board");
      theaterRef.current?.hoverSel(null);
      setSelKey("board");
      setCrumb(CRUMB_BOARD);
      await sleep(300, signal);

      // Beat 7 — over to the workspace chat column.
      await moveTo(q(".sh-ws__dock .sh-terra-chat"), 600);
      const chat = chatRef.current;
      if (!chat) return;

      await typeText(MSG_USER_BIGGER);
      chat.setPromptText("");
      chat.postUser(MSG_USER_BIGGER);
      await sleep(200, signal);
      chat.setThinking(true);
      await sleep(1200, signal);
      chat.setThinking(false);
      chat.postTerra(theaterRef.current?.applyTransform(MSG_USER_BIGGER) ?? MSG_TERRA_TYPE);
      await sleep(1400, signal);

      // Beat 8 — PR exchange.
      chat.postTerra(MSG_TERRA_PR);
      await sleep(900, signal);
      await typeText(MSG_USER_YES);
      chat.setPromptText("");
      chat.postUser(MSG_USER_YES);
      chat.setThinking(true);
      await sleep(800, signal);
      chat.setThinking(false);
      chat.postTerra(MSG_TERRA_DONE);

      // Beat 9 — hold the finished frame, then fade for the loop seam.
      await sleep(3000, signal);
      setCursor((c) => ({ ...c, visible: false }));
      await sleep(300, signal);
    };

    const resetAll = () => {
      setCursor((c) => ({ ...c, pressed: false, visible: false }));
      filmRef.current?.hoverNode(null);
      filmRef.current?.selectNode(null);
      filmRef.current?.openPreview(false);
      setSelKey(null);
      setCrumb(null);
      setPhase("scan");
      setScanLabel(SCAN_LABELS[0]);
      setElapsed(0);
      setCycle((v) => v + 1);
    };

    (async () => {
      for (;;) {
        await playOnce();
        if (signal.aborted) return;
        resetAll();
        await sleep(600, signal); // breath before the loop rescans
      }
    })().catch(() => {});

    return () => {
      ctl.abort();
      resetAll();
    };
  }, [inView, reduced, dropped]);

  // Reduced motion: hold the finished frame — full workspace, map open,
  // board accented, conversation seeded.
  useEffect(() => {
    if (!reduced) return;
    const ctl = new AbortController();
    setPhase("map");
    setSelKey("board");
    setCrumb(CRUMB_BOARD);
    (async () => {
      await sleep(50, ctl.signal); // map mounts after the phase flip
      filmRef.current?.selectNode("web");
      filmRef.current?.openPreview(true);
      const board = await waitForEl(
        () => theaterRef.current?.getSelEl("board") ?? null,
        ctl.signal,
      );
      if (!board) return;
      theaterRef.current?.selectSel("board");
      theaterRef.current?.applyTransform(MSG_USER_BIGGER);
    })().catch(() => {});
    return () => ctl.abort();
  }, [reduced]);

  return (
    <div className="sh-hero-demo" ref={rootRef}>
      <div className="sh-hero-demo__film" inert>
        <HeroWorkspaceShell
          key={cycle}
          phase={phase}
          filmRef={filmRef}
          theaterRef={theaterRef}
          chatRef={chatRef}
          scanLabel={scanLabel}
          elapsed={elapsed}
          selKey={selKey}
          crumb={crumb}
          initialChat={reduced ? FINAL_CHAT : undefined}
        />
      </div>
      {!reduced && <DemoCursor cursor={cursor} />}
    </div>
  );
}
