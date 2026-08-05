/**
 * Motion presets, measured once and reused everywhere. Kept out of any route
 * so shared components (the map diagram) can animate without importing a page.
 */

export const spring = { type: "spring", damping: 60, stiffness: 400 } as const;

// Section reveal trigger: fires when ~40% of the section is visible
// (headings reveal around mid-viewport on tall sections, near the bottom
// edge on short ones like the footer).
export const inView = { once: true, amount: 0.4 } as const;

export const stagger = {
  show: { transition: { staggerChildren: 0.1 } },
} as const;

export const rise = {
  hidden: { opacity: 0, y: 150 },
  show: { opacity: 1, y: 0, transition: spring },
} as const;
