import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { useRef, useState } from "react";
import { ArrowIcon, MotionLink, TerraMark } from "../primitives";

const navCollapseSpring = {
  type: "spring",
  stiffness: 500,
  damping: 60,
  mass: 1,
} as const;

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

/** Width collapse used by every slot the pill opens and closes. */
const slot = (open: boolean) => (open ? { width: "auto", opacity: 1 } : { width: 0, opacity: 0 });

export function SiteNav() {
  const collapsed = useNavCollapse();
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : navCollapseSpring;
  const showLinks = !collapsed;

  return (
    <nav className="sh-nav">
      <div className="sh-nav__pill">
        <div className="sh-nav__slot">
          <a className="sh-nav__logo" href="#top">
            <TerraMark className={collapsed ? "sh-terra-mark--collapsed" : ""} />
            <span className="sh-nav__word">Terra</span>
          </a>
        </div>
        <motion.div
          id="sh-nav-links"
          className="sh-nav__slot sh-nav__links"
          initial={false}
          animate={slot(showLinks)}
          transition={transition}
          aria-hidden={!showLinks}
          // `inert` over tabIndex/pointer-events: a collapsed slot is 0px wide
          // but still focusable, so tabbing parked the ring on invisible content.
          inert={showLinks ? undefined : true}
        >
          <a className="sh-nav__link" href="#power">
            How it works
          </a>
          <a className="sh-nav__link" href="#faq">
            Case study
          </a>
        </motion.div>
        <div className="sh-nav__slot">
          <MotionLink
            className="sh-btn sh-btn--nav"
            to="/new"
            whileTap={reduce ? undefined : { scale: 0.98 }}
          >
            Try it <ArrowIcon />
          </MotionLink>
        </div>
      </div>
    </nav>
  );
}
