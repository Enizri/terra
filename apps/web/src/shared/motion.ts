/** Shared motion presets (route-free). */

export const spring = { type: "spring", damping: 60, stiffness: 400 } as const;

/** Reveal once the section overlaps the middle band of the viewport.
 *  Deliberately a margin and not an `amount` ratio: a section taller than
 *  ~2.5x the viewport can never reach a 0.4 intersection ratio, so on phones
 *  the trigger would never fire and the section would stay at `opacity: 0`. */
export const inView = { once: true, margin: "-25% 0px -25% 0px" } as const;

export const stagger = {
  show: { transition: { staggerChildren: 0.1 } },
} as const;

export const rise = {
  hidden: { opacity: 0, y: 150 },
  show: { opacity: 1, y: 0, transition: spring },
} as const;
