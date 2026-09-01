import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowIcon, MotionLink, TerraMark } from "../primitives";

const navCollapseSpring = {
  type: "spring",
  stiffness: 500,
  damping: 60,
  mass: 1,
} as const;

/** Fraction of the Power section that may sit above the probe line before the
 *  nav un-docks — past its middle we are on our way out, so it comes back. */
const DOCK_EXIT = 0.55;
/** Dead band on both dock edges, as a fraction of the section. The smooth
 *  scroll loop settles on a target in sub-pixel steps, and a bare threshold
 *  would sit on the boundary flipping the whole nav back and forth. */
const DOCK_SLACK = 0.02;

/** Parker-style: collapse nav links on scroll down, expand on scroll up. */
function useNavCollapse() {
  const [collapsed, setCollapsed] = useState(false);
  const { scrollY } = useScroll();
  const lastY = useRef(0);
  const collapsedRef = useRef(false);

  useMotionValueEvent(scrollY, "change", (y) => {
    const delta = y - lastY.current;
    // Ignore sub-threshold jitter (layout/sticky can nudge scrollY a few px).
    if (Math.abs(delta) < 16 && y >= 24) return;
    lastY.current = y;

    let next = collapsedRef.current;
    if (y < 24) next = false;
    else if (delta > 0) next = true;
    else if (delta < 0) next = false;

    if (next !== collapsedRef.current) {
      collapsedRef.current = next;
      setCollapsed(next);
    }
  });

  return collapsed;
}

/** True while we are reading the upper half of the Power window section.
 *  Measured against a probe line at mid-viewport: the dock trips as the
 *  section's top edge rises past it, and lets go once its middle does, so
 *  scrolling on through the section hands the normal nav back.
 *
 *  The section's box is cached in document space and only remeasured when the
 *  page can have reflowed. Reading it per scroll frame meant a layout read
 *  inside the loop that is writing scroll positions, and left the dock state
 *  undecided until the first scroll — a reload part-way down the section came
 *  up with the wrong nav. */
function useNavDock() {
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    const section = document.getElementById("power");
    if (!section) return;

    let top = 0;
    let height = 0;
    let inside = false;

    const evaluate = () => {
      if (!height) return;
      // 0 as the section's top crosses the probe, 1 as its bottom does.
      const travelled = (window.scrollY + window.innerHeight / 2 - top) / height;
      const next = inside
        ? travelled >= -DOCK_SLACK && travelled <= DOCK_EXIT + DOCK_SLACK
        : travelled >= DOCK_SLACK && travelled <= DOCK_EXIT - DOCK_SLACK;
      if (next === inside) return;
      inside = next;
      setDocked(next);
    };

    const measure = () => {
      const rect = section.getBoundingClientRect();
      top = rect.top + window.scrollY;
      height = rect.height;
      evaluate();
    };

    measure();
    // The section resizing moves its bottom edge; the document resizing moves
    // its top. Both change where the dock starts and stops.
    const resize = new ResizeObserver(measure);
    resize.observe(section);
    resize.observe(document.documentElement);
    window.addEventListener("scroll", evaluate, { passive: true });
    return () => {
      resize.disconnect();
      window.removeEventListener("scroll", evaluate);
    };
  }, []);

  return docked;
}

/** Width collapse used by every slot the pill opens and closes. */
const slot = (open: boolean) => (open ? { width: "auto", opacity: 1 } : { width: 0, opacity: 0 });

export function SiteNav() {
  const collapsed = useNavCollapse();
  const docked = useNavDock();
  const [menuOpen, setMenuOpen] = useState(false);
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : navCollapseSpring;

  // Derived, not an effect: leaving the section has to restore the nav in the
  // same render that un-docks it, or the pill plays a second layout animation
  // one commit later and visibly stutters on the way out.
  const open = docked && menuOpen;
  useEffect(() => {
    if (!docked) setMenuOpen(false);
  }, [docked]);

  const compact = docked && !open;
  const showLinks = docked ? open : !collapsed;
  const showCta = !docked || open;

  return (
    <nav className={`sh-nav${docked ? " sh-nav--docked" : ""}`}>
      <motion.div
        className={`sh-nav__pill${compact ? " sh-nav__pill--compact" : ""}`}
        // The dock swaps which margin is `auto`; `layout` is what turns that
        // reflow into a glide instead of a jump. Nothing else on the pill may
        // carry a CSS transition — a box that moves outside motion's snapshots
        // fights the projection and the pill wobbles.
        layout
        transition={transition}
      >
        <motion.div
          className="sh-nav__slot"
          initial={false}
          animate={slot(!docked)}
          transition={transition}
          aria-hidden={docked}
          // `inert` over tabIndex/pointer-events: a collapsed slot is 0px wide
          // but still focusable, so tabbing (or holding focus while the page
          // scrolls into the dock) parked the ring on invisible content.
          inert={docked ? true : undefined}
        >
          <a className="sh-nav__logo" href="#top">
            <TerraMark className={collapsed ? "sh-terra-mark--collapsed" : ""} />
            <span className="sh-nav__word">Terra</span>
          </a>
        </motion.div>
        <motion.div
          className="sh-nav__slot"
          initial={false}
          animate={slot(docked)}
          transition={transition}
          aria-hidden={!docked}
          inert={docked ? undefined : true}
        >
          <button
            type="button"
            className={`sh-nav__burger${open ? " is-open" : ""}`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="sh-nav-links"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </motion.div>
        <motion.div
          id="sh-nav-links"
          className="sh-nav__slot sh-nav__links"
          initial={false}
          animate={slot(showLinks)}
          transition={transition}
          aria-hidden={!showLinks}
          inert={showLinks ? undefined : true}
        >
          <a className="sh-nav__link" href="#power">
            How it works
          </a>
          <a className="sh-nav__link" href="#faq">
            Case study
          </a>
        </motion.div>
        <motion.div
          className="sh-nav__slot"
          initial={false}
          animate={slot(showCta)}
          transition={transition}
          aria-hidden={!showCta}
          inert={showCta ? undefined : true}
        >
          <MotionLink
            className="sh-btn sh-btn--nav"
            to="/new"
            whileTap={reduce ? undefined : { scale: 0.98 }}
          >
            Try it <ArrowIcon />
          </MotionLink>
        </motion.div>
      </motion.div>
    </nav>
  );
}
