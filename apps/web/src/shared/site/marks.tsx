// Brand atoms the site chrome needs on every page. They live here rather than
// in a route so a second page can wear the same nav — `boundaries.test.ts`
// forbids one route importing another.
import { motion } from "motion/react";
import { Link } from "react-router-dom";

export const MotionLink = motion.create(Link);

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

/** Brand gradient mark. */
export function TerraMark({ className }: { className?: string }) {
  return <span className={`sh-terra-mark${className ? ` ${className}` : ""}`} aria-hidden />;
}
