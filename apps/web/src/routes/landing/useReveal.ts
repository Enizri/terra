import { useLayoutEffect, useRef } from "react";

/** Marks an element as a member of its section's reveal sequence. */
export const REVEAL_ATTR = "data-reveal";

/** How far up the viewport a section's top edge must come before its sequence
 *  plays, as a fraction of the viewport height. */
const TRIP = 0.15;

/**
 * Scroll reveal for a whole section: members start shifted down and
 * transparent, then settle in DOM order once the section reaches the reader.
 *
 * One observer on the container drives every member, so the section plays as a
 * single sequence. Per-element observers were the bug: each block crossed its
 * own line at its own moment, and a tall block (the FAQ list) tripped while
 * most of it was still below the fold, so pieces arrived out of order and
 * already-revealed content scrolled into view.
 *
 * The pending class is applied in a layout effect rather than in JSX so the
 * content is visible when JS never runs, and never paints before it hides.
 */
export function useRevealGroup<T extends HTMLElement = HTMLElement>(
  stepMs = 90,
  shiftPx?: number,
) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const members = Array.from(root.querySelectorAll<HTMLElement>(`[${REVEAL_ATTR}]`));
    if (!members.length) return;

    // Already on screen at mount — a reload part-way down, or a deep link.
    // Arming the reveal here would blank the section for the frames before the
    // observer's first callback lands, then play a stagger nobody scrolled
    // into: the section would look like it was popping in at random.
    const rect = root.getBoundingClientRect();
    if (rect.top < window.innerHeight * (1 - TRIP) && rect.bottom > 0) return;

    members.forEach((el, i) => {
      // Hide first, without the transition class. Adding both together after
      // the layout flush above would ease the members *out* as they enter.
      el.classList.add("terra-reveal-pending");
      el.style.transitionDelay = `${i * stepMs}ms`;
      if (shiftPx !== undefined) el.style.setProperty("--reveal-shift", `${shiftPx}px`);
    });

    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      for (const el of members) el.classList.add("terra-reveal");
    };
    const armFrame = window.requestAnimationFrame(arm);

    let settle = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        arm();
        // Commit pending+transition before we un-hide, or the first paint
        // is already the settled state and the rise is skipped.
        void root.offsetWidth;
        for (const el of members) el.classList.remove("terra-reveal-pending");
        // Once the sequence has played, drop the transition (and with it the
        // `will-change` hint) so the section stops holding a compositor layer.
        settle = window.setTimeout(() => {
          for (const el of members) {
            el.classList.remove("terra-reveal");
            el.style.transitionDelay = "";
          }
          // Longest member transition (1s) plus room for the last delay.
        }, members.length * stepMs + 1200);
      },
      // Trip as the section's top edge comes up the screen, not when it is
      // already sitting under the reader's eye.
      { rootMargin: `0px 0px -${TRIP * 100}% 0px` },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(armFrame);
      window.clearTimeout(settle);
    };
  }, [stepMs, shiftPx]);

  return ref;
}
