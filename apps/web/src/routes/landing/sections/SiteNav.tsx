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

export function SiteNav() {
  const collapsed = useNavCollapse();
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : navCollapseSpring;

  return (
    <nav className="sh-nav">
      <div className="sh-nav__pill">
        <a className="sh-nav__logo" href="#top">
          <TerraMark className={collapsed ? "sh-terra-mark--collapsed" : ""} />
          <span>Terra</span>
        </a>
        <motion.div
          className="sh-nav__links"
          initial={false}
          animate={
            collapsed
              ? { width: 0, opacity: 0, marginInline: 0 }
              : { width: "auto", opacity: 1, marginInline: 0 }
          }
          transition={transition}
          aria-hidden={collapsed}
          style={{ pointerEvents: collapsed ? "none" : "auto" }}
        >
          <a className="sh-nav__link" href="#power" tabIndex={collapsed ? -1 : undefined}>
            How it works
          </a>
          <a className="sh-nav__link" href="#faq" tabIndex={collapsed ? -1 : undefined}>
            Case study
          </a>
        </motion.div>
        <MotionLink
          className="sh-btn sh-btn--nav"
          to="/new"
          whileTap={reduce ? undefined : { scale: 0.98 }}
        >
          Try it <ArrowIcon />
        </MotionLink>
      </div>
    </nav>
  );
}
