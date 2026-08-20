import { AnimatePresence, motion } from "motion/react";

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Single evolving status line. */
export function StatusLine({ label, elapsed }: { label: string; elapsed: number }) {
  return (
    <div className="sh-ws__status" aria-live="polite">
      <span className="sh-terra-mark sh-terra-mark--spin sh-ws__status-mark" aria-hidden />
      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          className="sh-ws__status-label"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
      <em className="sh-ws__status-time">{clock(elapsed)}</em>
    </div>
  );
}
