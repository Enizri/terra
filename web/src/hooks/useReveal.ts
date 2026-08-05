import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

// One shared scroll reveal: fade + rise the section (or its `targets`) once
// when it enters the viewport. The only animation abstraction in the site.
export function useReveal<T extends HTMLElement>(opts?: {
  targets?: string;
  stagger?: number;
  x?: number;
}) {
  const ref = useRef<T>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const targets = opts?.targets
        ? ref.current!.querySelectorAll(opts.targets)
        : ref.current;
      gsap.from(targets, {
        y: 44,
        x: opts?.x ?? 0,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger: opts?.stagger ?? 0,
        scrollTrigger: { trigger: ref.current, start: "top 78%", once: true },
      });
    },
    { scope: ref },
  );

  return ref;
}
