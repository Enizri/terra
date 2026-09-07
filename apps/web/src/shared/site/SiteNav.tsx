import { motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowIcon, MotionLink, TerraMark } from "./marks";

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

export type NavLink = {
  /** `#id` stays a plain anchor so the landing's eased glide handler owns it;
   *  anything else is a route and must not full-page reload. */
  href: string;
  label: string;
  /** The page the reader is already on. */
  current?: boolean;
};

/** One rule decides the element: a fragment is a same-page anchor, everything
 *  else is a route. Getting this wrong is a full page reload, not a style bug. */
function NavAnchor({ href, label, current }: NavLink) {
  const props = {
    className: "sh-nav__link",
    ...(current ? { "aria-current": "page" as const } : {}),
  };
  return href.startsWith("#") ? (
    <a {...props} href={href}>
      {label}
    </a>
  ) : (
    <Link {...props} to={href}>
      {label}
    </Link>
  );
}

/** Site chrome, worn by every marketing page. `home` is where the logo goes —
 *  the landing keeps `#top` so the glide handler catches it, other pages route
 *  back to `/`. */
export function SiteNav({ home, links }: { home: string; links: NavLink[] }) {
  const collapsed = useNavCollapse();
  const reduce = useReducedMotion();
  const transition = reduce ? { duration: 0 } : navCollapseSpring;
  const showLinks = !collapsed;
  const mark = (
    <>
      <TerraMark className={collapsed ? "sh-terra-mark--collapsed" : ""} />
      <span className="sh-nav__word">Terra</span>
    </>
  );

  return (
    <nav className="sh-nav">
      <div className="sh-nav__pill">
        <div className="sh-nav__slot">
          {home.startsWith("#") ? (
            <a className="sh-nav__logo" href={home}>
              {mark}
            </a>
          ) : (
            <Link className="sh-nav__logo" to={home}>
              {mark}
            </Link>
          )}
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
          {links.map((link) => (
            <NavAnchor key={link.href} {...link} />
          ))}
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
