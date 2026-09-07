import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
// Newsreader: landing display face. opsz so large headlines use the display cut.
import "@fontsource-variable/newsreader/opsz.css";
import "../../shared/styles/tokens.css";
import "../../shared/styles/ui.css";
import "./landing.css";
import { SiteNav } from "../../shared/site/SiteNav";
import { anchorId, anchorScrollTop } from "./anchors";
import { Hero } from "./sections/Hero";
import { GlobeJourney } from "./sections/GlobeJourney";
import { PowerSection } from "./sections/PowerSection";
import { Faq } from "./sections/Faq";
import { Final } from "./sections/Final";

const SMOOTH_SCROLL_EASE = 0.18;
/** Anchor glides are a ride, not a jump: gentler pull than the wheel's. */
const ANCHOR_EASE = 0.07;
/** How fast the glide's pull comes up from nothing, so it eases in as well as
 *  out instead of launching at full speed. */
const ANCHOR_RAMP = 0.07;
/** Wheel delta multiplier — under 1 so one flick covers less ground, but not
 *  so far under that the page reads as sluggish. At 0.24 a flick travelled a
 *  quarter of its native distance over a third of a second, which is felt as
 *  the site being slow rather than as smoothing. */
const SMOOTH_SCROLL_GAIN = 0.7;
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

/** Eased scrolling for the pinned hero scrub, and the single owner of where
 *  the page is heading. Anchor clicks glide through the same loop rather than
 *  a native smooth scroll — two animators fighting over scrollY is why a
 *  second click could land on a page that immediately snapped back. */
function useSmoothScroll() {
  const reduced = useReducedMotion();
  const glideRef = useRef<(y: number) => void>(() => {});
  useEffect(() => {
    let target = window.scrollY;
    let raf = 0;
    let running = false;

    const maxY = () =>
      document.documentElement.scrollHeight - window.innerHeight;

    // Where we left the page last frame. If it moved without us — lazy images,
    // a section resizing, scroll anchoring — the target is stale by exactly
    // that much, and easing toward it would drag the reader back.
    let expected = -1;
    // A glide from a click eases in and pulls softer than a wheel flick, which
    // has to answer the hand immediately. `ramp` is the ease-in.
    let gliding = false;
    let ramp = 0;

    const tick = () => {
      if (expected >= 0) target += window.scrollY - expected;
      const diff = target - window.scrollY;
      if (Math.abs(diff) < 0.5) {
        window.scrollTo(0, target);
        expected = -1;
        running = false;
        gliding = false;
        return;
      }
      let ease = SMOOTH_SCROLL_EASE;
      if (gliding) {
        ramp += (1 - ramp) * ANCHOR_RAMP;
        ease = ANCHOR_EASE * ramp;
      }
      window.scrollTo(0, window.scrollY + diff * ease);
      expected = window.scrollY;
      raf = requestAnimationFrame(tick);
    };

    /** Aim the page at `y`, from a click or anything else that is not a wheel. */
    const glide = (y: number) => {
      target = Math.min(maxY(), Math.max(0, y));
      // Re-pressing mid-glide re-aims without restarting the ease-in, so the
      // page never lurches; a fresh press from rest starts soft.
      if (!gliding) ramp = 0;
      gliding = true;
      if (running) return;
      running = true;
      expected = -1;
      raf = requestAnimationFrame(tick);
    };
    glideRef.current = reduced ? (y) => window.scrollTo(0, y) : glide;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      const raw = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY;
      const dy = raw * SMOOTH_SCROLL_GAIN;
      if (scrollableUnder(e.target, dy)) return;
      e.preventDefault();
      // The hand wins: a wheel flick takes the loop back off the glide.
      gliding = false;
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

    // The wheel is only intercepted where it is a wheel: a trackpad or mouse
    // on a fine pointer, motion allowed. Anchor glides work everywhere.
    const wheeling =
      reduced === false && window.matchMedia("(pointer: fine)").matches;
    if (wheeling) window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      if (wheeling) window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduced]);

  return glideRef;
}

/** Same-page links (nav, hero CTA, footer) ease to their section instead of
 *  teleporting, every time they are pressed and from wherever the reader is. */
function useSmoothAnchors(glideRef: { current: (y: number) => void }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      const id = anchorId(href);
      if (!href?.startsWith("#")) return;

      const section = id ? document.getElementById(id) : null;
      // A bare `#` or an id nothing carries is a placeholder — swallow the
      // click so the page does not lurch to the top under the reader.
      event.preventDefault();
      if (!section) return;
      const nav = document.querySelector(".sh-nav");
      const top = anchorScrollTop(
        window.scrollY,
        section.getBoundingClientRect().top,
        nav ? nav.getBoundingClientRect().height : 0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      glideRef.current(top);
      // replaceState, not the hash itself: setting location.hash would jump.
      history.replaceState(null, "", href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [glideRef]);
}

/** A reload lands on the hero, wherever the reader had scrolled to.
 *
 *  Two browser behaviours have to be turned off for that. Scroll restoration
 *  puts a reload back where the reader left off, and a fragment left in the
 *  URL by an anchor click (`/#faq`) is re-resolved on load as the section it
 *  names mounts. The landing is a scripted ride — the pinned hero scrub, the
 *  globe flight, the reveal sequences all read from a scroll position they
 *  expect to have watched arrive — so dropping a reader into the middle of it
 *  restores a scroll offset without the state that earned it.
 *
 *  A layout effect is early enough for both: React mounts while the module
 *  script runs, before `load`, and the fragment's target does not exist in the
 *  served HTML, so the browser has nothing to scroll to until we have already
 *  taken the hash off the URL. Restoration goes back to `auto` on the way out,
 *  since it is a property of the whole history, not of this route. */
function useTopOnLoad() {
  useLayoutEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const { pathname, search, hash } = window.location;
    // replaceState, not the hash itself: clearing location.hash would scroll.
    if (hash) history.replaceState(null, "", pathname + search);
    window.scrollTo(0, 0);
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);
}

/** Nav destinations. `#power` rides the eased glide handler below; `/about` is
 *  a route, so SiteNav renders it as a Link rather than a reloading anchor. */
const NAV_LINKS = [
  { href: "#power", label: "How it works" },
  { href: "/about", label: "About" },
];

export default function TerraLanding() {
  // No splash/loader — paint nav + hero immediately.
  // The theater opens inside whichever repo card was clicked, so each
  // RepoMapDiagram owns it — nothing to lift up here.
  useTopOnLoad();
  useSmoothAnchors(useSmoothScroll());
  return (
    <MotionConfig reducedMotion="user">
      <div className="sh-root sh-root--landing">
        <SiteNav home="#top" links={NAV_LINKS} />

        <Hero />

        <GlobeJourney>
          <PowerSection />
          <Faq />
          <Final />
        </GlobeJourney>
      </div>
    </MotionConfig>
  );
}
