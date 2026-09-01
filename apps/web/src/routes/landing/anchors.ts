/* In-page anchor targets for the nav and the hero CTA. Pure so the offset
   maths can be checked without a document. */

/** Breathing room under the sticky nav pill, px. */
export const ANCHOR_GAP = 12;

/** Absolute scroll position that parks `rectTop` just under the nav.
 *  `rectTop` is viewport-relative, the way getBoundingClientRect reports it. */
export function anchorScrollTop(
  scrollY: number,
  rectTop: number,
  navHeight: number,
  maxY: number,
) {
  const top = scrollY + rectTop - navHeight - ANCHOR_GAP;
  return Math.max(0, Math.min(maxY, top));
}

/** The element a same-page link points at — `null` for a bare `#`, which
 *  means the top of the page. */
export function anchorId(href: string | null) {
  if (!href || !href.startsWith("#")) return null;
  const id = href.slice(1);
  return id.length > 0 ? id : null;
}
