import { useEffect, useRef } from "react";

/**
 * Scroll reveal: elements start shifted down and transparent, then
 * settle once they enter the viewport. One observer per element, disconnected
 * after the first hit — the reveal never plays twice.
 *
 * The pending class is applied in an effect rather than in JSX so the content
 * is visible when JS never runs.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(delayMs = 0, shiftPx?: number) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.classList.add("hl-reveal", "hl-reveal-pending");
    el.style.transitionDelay = delayMs ? `${delayMs}ms` : "";
    if (shiftPx !== undefined) el.style.setProperty("--reveal-shift", `${shiftPx}px`);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.classList.remove("hl-reveal-pending");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs, shiftPx]);

  return ref;
}
