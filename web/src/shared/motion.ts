/** Shared motion presets (route-free). */

export const spring = { type: "spring", damping: 60, stiffness: 400 } as const;

/** Reveal when ~40% of the section is visible. */
export const inView = { once: true, amount: 0.4 } as const;

export const stagger = {
  show: { transition: { staggerChildren: 0.1 } },
} as const;

export const rise = {
  hidden: { opacity: 0, y: 150 },
  show: { opacity: 1, y: 0, transition: spring },
} as const;
