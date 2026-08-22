import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
// Gilda Display: the landing's serif display face. 400 is the only weight it ships.
import "@fontsource/gilda-display/400.css";
import "../../shared/styles/tokens.css";
import "../../shared/styles/ui.css";
import "./landing.css";
import { SiteNav } from "./sections/SiteNav";
import { HeroChars } from "./sections/HeroChars";
import { GlobeJourney } from "./sections/GlobeJourney";
import { PowerSection } from "./sections/PowerSection";
import { Faq } from "./sections/Faq";
import { Final } from "./sections/Final";

const SMOOTH_SCROLL_EASE = 0.12;
/** Wheel delta multiplier — under 1 so one flick covers less ground. */
const SMOOTH_SCROLL_GAIN = 0.24;
/** A "line" of wheel delta (deltaMode 1) in px. */
const WHEEL_LINE_PX = 16;

/** True if `el` or an ancestor can still scroll `dy`. */
function scrollableUnder(el: EventTarget | null, dy: number) {
  let node = el instanceof Element ? el : null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const scrolls = /auto|scroll|overlay/.test(style.overflowY);
    if (scrolls && node.scrollHeight > node.clientHeight) {
      const room = dy > 0
        ? node.scrollHeight - node.clientHeight - node.scrollTop
        : node.scrollTop;
      if (room > 1) return true;
    }
    node = node.parentElement;
  }
  return false;
}

/** Eased wheel scrolling for the pinned hero scrub. */
function useSmoothWheelScroll() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced !== false || !window.matchMedia("(pointer: fine)").matches) return;
    let target = window.scrollY;
    let raf = 0;
    let running = false;

    const maxY = () =>
      document.documentElement.scrollHeight - window.innerHeight;

    // Where we left the page last frame. If it moved without us — lazy images,
    // a section resizing, scroll anchoring — the target is stale by exactly
    // that much, and easing toward it would drag the reader back.
    let expected = -1;

    const tick = () => {
      if (expected >= 0) target += window.scrollY - expected;
      const diff = target - window.scrollY;
      if (Math.abs(diff) < 0.5) {
        window.scrollTo(0, target);
        expected = -1;
        running = false;
        return;
      }
      window.scrollTo(0, window.scrollY + diff * SMOOTH_SCROLL_EASE);
      expected = window.scrollY;
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      const raw = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
      const dy = raw * SMOOTH_SCROLL_GAIN;
      if (scrollableUnder(e.target, dy)) return;
      e.preventDefault();
      if (!running) target = window.scrollY;
      target = Math.min(maxY(), Math.max(0, target + dy));
      if (!running) {
        running = true;
        expected = -1;
        raf = requestAnimationFrame(tick);
      }
    };

    // Anything that scrolls us by other means owns the target from then on.
    const onScroll = () => {
      if (!running) target = window.scrollY;
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduced]);
}

export default function TerraLanding() {
  // No splash/loader — paint nav + hero immediately.
  // The theater opens inside whichever repo card was clicked, so each
  // RepoMapDiagram owns it — nothing to lift up here.
  useSmoothWheelScroll();
  return (
    <MotionConfig reducedMotion="user">
      <div className="sh-root sh-root--landing">
        <SiteNav />

        <GlobeJourney>
          <HeroChars />
          <PowerSection />
          <Faq />
          <div className="gx-journey__footer-dock" aria-hidden />
        </GlobeJourney>
        <Final />
      </div>
    </MotionConfig>
  );
}
