import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { users, type User } from "../data";
import { MemosExploreReplica } from "../theater";
import { Picture } from "../primitives";

/** One beat of the loop, ms. */
const PLAY_STEP_MS = 1400;
/** Steps in the loop — last one resets the UI so the film can replay. */
const PLAY_STEPS = 7;

/** Cursor colors — match the users' avatar rings (bg-amber / indigo / green). */
const PLAY_HEX: Record<string, string> = {
  "1": "#f59e0b",
  "2": "#6366f1",
  "3": "#22c55e",
};

type PlayCursor = {
  user: User;
  /** [x%, y%] inside the window, one waypoint per step. */
  path: [number, number][];
  /** step → chat bubble spoken at that waypoint. */
  say: Record<number, string>;
};

const PLAY_CURSORS: PlayCursor[] = [
  {
    user: users[0], // Evyatar → the nav rail
    path: [[68, 66], [3, 38], [3, 42], [6, 56], [9, 62], [11, 58], [60, 70]],
    // Announce one step before the edit lands, hold the bubble through it.
    say: { 1: "Paint the nav brand orange", 2: "Paint the nav brand orange" },
  },
  {
    user: users[1], // Maya → the memo cards
    path: [[42, 14], [48, 20], [54, 32], [56, 30], [58, 38], [50, 48], [44, 20]],
    say: { 3: "Rounder cards, please", 4: "Rounder cards, please" },
  },
  {
    user: users[2], // Leo → the activity heatmap
    path: [[86, 78], [80, 68], [70, 58], [40, 54], [19, 42], [16, 38], [80, 74]],
    say: { 4: "Light up the activity graph", 5: "Light up the activity graph" },
  },
];

function PlayCursorSprite({ c, step }: { c: PlayCursor; step: number }) {
  const [x, y] = c.path[step];
  const msg = c.say[step];
  const hex = PLAY_HEX[c.user.id];
  return (
    <motion.div
      className="sh-play-cursor"
      initial={false}
      animate={{ left: `${x}%`, top: `${y}%` }}
      transition={{ type: "spring", stiffness: 80, damping: 17 }}
    >
      <svg width="20" height="24" viewBox="0 0 18 22" aria-hidden>
        <path
          fill={hex}
          stroke="#fff"
          strokeWidth="1.2"
          strokeLinejoin="round"
          d="M1.2 1.2v15.6l3.9-3.8 2.5 6 2.2-.9-2.5-6h6.4L1.2 1.2z"
        />
      </svg>
      <span className="sh-play-cursor__name" style={{ background: hex }}>
        {c.user.name}
      </span>
      <AnimatePresence>
        {msg && (
          <motion.span
            key={msg}
            className="sh-play-cursor__say"
            style={{ borderColor: hex }}
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {msg}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Live collaboration film: named cursors restyle the app replica. */
export function PlaygroundStage() {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setTick((s) => (s + 1) % PLAY_STEPS), PLAY_STEP_MS);
    return () => clearInterval(id);
  }, [reduced]);
  // Reduced motion: hold the fully-edited frame instead of playing the film.
  const step = reduced ? 5 : tick;

  return (
    <div
      className="sh-playground"
      data-edit-nav={step >= 2 && step <= 5 ? "1" : "0"}
      data-edit-cards={step >= 4 && step <= 5 ? "1" : "0"}
      data-edit-heat={step === 5 ? "1" : "0"}
      data-aim={step === 1 ? "nav" : step === 3 ? "cards" : step === 5 ? "heat" : ""}
    >
      <div className="sh-replica sh-replica--playground" inert>
        <MemosExploreReplica />
      </div>
      {PLAY_CURSORS.map((c) => (
        <PlayCursorSprite key={c.user.id} c={c} step={step} />
      ))}
      <div className="sh-play-presence">
        {PLAY_CURSORS.map(({ user: u }) => (
          <Picture key={u.id} base={u.photo} alt={u.name} />
        ))}
        <span>Live in the playground</span>
      </div>
    </div>
  );
}
