import { motion } from "motion/react";
import { useEffect } from "react";
import { inView, rise, stagger } from "../../../shared/motion";
import { copy } from "../data";
import { ArrowIcon, MotionLink, STAR_DOCK_MS, STAR_ENTRY_RISE_VH, TerraMark } from "../primitives";

export function Final() {
  return (
    <motion.div
      className="sh-final"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      <motion.div className="sh-final__glyph" variants={rise}>
        <TerraMark />
      </motion.div>
      <h2>
        <motion.span variants={rise}>{copy.final[0]}</motion.span>
        <br />
        <motion.span variants={rise}>{copy.final[1]}</motion.span>
      </h2>
      <MotionLink
        to="/new"
        className="sh-btn"
        variants={rise}
        whileTap={{ scale: 0.98 }}
        style={{ margin: "24px 0 8px" }}
      >
        Map your repo <ArrowIcon />
      </MotionLink>
      <motion.div className="sh-footer-links" variants={rise}>
        <div>
          <a href="#">GitHub</a>
          <span>•</span>
          <a href="#">LinkedIn</a>
        </div>
        <div>
          <a href="#">Terms of service</a>
          <span>•</span>
          <a href="#">Privacy Policy</a>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** True while the star is docked in the Final glyph. */
let starDocked = false;
/** Ease-in-out on 0..1 — used to soften the scroll-driven section handoff. */
function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

/** Match `.sh-backdrop` cubic-bezier(0.22, 1, 0.36, 1) well enough for JS dock. */
function starDockEase(t: number) {
  return 1 - Math.pow(1 - t, 3.2);
}

/** Dock the travelling star onto the Final glyph. */
export function useStarFinalDock() {
  useEffect(() => {
    const star = document.querySelector<HTMLElement>(".sh-backdrop");
    const glyph = document.querySelector<HTMLElement>(".sh-final__glyph");
    if (!star || !glyph) return;

    let raf = 0;
    let dockStartedAt = 0;

    const setPose = (x: number, y: number, scale: number) => {
      star.style.setProperty("--sh-star-scale", `${scale}`);
      star.style.setProperty("--sh-star-x", `${x}px`);
      star.style.setProperty("--sh-star-y", `${y}px`);
    };

    /** Glyph centre relative to the untransformed star box (viewport coords). */
    const glyphTarget = () => {
      const g = glyph.getBoundingClientRect();
      const w = star.offsetWidth;
      const h = star.offsetHeight;
      if (!w || !h) return null;
      return {
        x: g.left + g.width / 2 - (star.offsetLeft + w / 2),
        y: g.top + g.height / 2 - (star.offsetTop + h / 2),
        scale: g.width / w,
      };
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting === starDocked) return;
        starDocked = entry.isIntersecting;
        glyph.classList.toggle("sh-final__glyph--handoff", starDocked);

        if (starDocked) {
          // JS-drive the dock so the target can scroll without a late snap.
          star.classList.add("sh-backdrop--docked");
          const from = star.getBoundingClientRect();
          const w = star.offsetWidth;
          const h = star.offsetHeight;
          if (!w || !h) return;
          const startX = from.left + from.width / 2 - (star.offsetLeft + w / 2);
          const startY = from.top + from.height / 2 - (star.offsetTop + h / 2);
          const startScale = from.width / w;
          dockStartedAt = performance.now();

          let trackedScrollY = -1;
          const track = () => {
            raf = requestAnimationFrame(track);
            const t = Math.min(
              1,
              (performance.now() - dockStartedAt) / STAR_DOCK_MS,
            );
            // Once settled the pose only changes when the glyph moves, i.e. on
            // scroll — otherwise this loop reflows every frame for nothing.
            if (t >= 1 && window.scrollY === trackedScrollY) return;
            trackedScrollY = window.scrollY;
            const target = glyphTarget();
            if (!target) return;
            if (t < 1) {
              const e = starDockEase(t);
              setPose(
                startX + (target.x - startX) * e,
                startY + (target.y - startY) * e,
                startScale + (target.scale - startScale) * e,
              );
            } else {
              setPose(target.x, target.y, target.scale);
            }
          };
          track();
          return;
        }
        cancelAnimationFrame(raf);
        raf = 0;
        star.classList.remove("sh-backdrop--docked");
        star.style.removeProperty("--sh-star-scale");
        // The section tracker owns the pose again from the next frame.
      },
      { threshold: 0.9 },
    );
    io.observe(glyph);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      starDocked = false;
    };
  }, []);
}

/** Scroll-scrubbed star approach into the final section. */
export function useStarFinalApproach() {
  useEffect(() => {
    const star = document.querySelector<HTMLElement>(".sh-backdrop");
    const final = document.querySelector<HTMLElement>(".sh-final");
    const glyph = document.querySelector<HTMLElement>(".sh-final__glyph");
    if (!star || !final || !glyph) return;

    let raf = 0;
    let lastScrollY = -1;
    let lastVh = -1;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      // The final dock drives the pose itself while it owns the star.
      if (starDocked) return;
      // Nothing scrolled → skip the layout reads. Idling here otherwise costs
      // a forced reflow every frame, forever.
      if (window.scrollY === lastScrollY && window.innerHeight === lastVh) return;
      lastScrollY = window.scrollY;
      lastVh = window.innerHeight;

      const vh = window.innerHeight;
      // 0 until the final section reaches the fold, 1 once it has climbed a
      // full viewport height — the star's whole descent rides that.
      const p = (vh - final.getBoundingClientRect().top) / vh;
      if (p <= 0) {
        star.classList.remove("sh-backdrop--revealed");
        star.style.removeProperty("--sh-star-x");
        star.style.removeProperty("--sh-star-y");
        return;
      }
      star.classList.add("sh-backdrop--revealed");

      // Land on the glyph's line; the dock takes it the rest of the way in.
      const g = glyph.getBoundingClientRect();
      const to = {
        x: g.left + g.width / 2 - (star.offsetLeft + star.offsetWidth / 2),
        y: g.top + g.height / 2 - (star.offsetTop + star.offsetHeight / 2),
      };
      const from = { x: to.x, y: to.y - vh * STAR_ENTRY_RISE_VH };
      const e = smoothstep(Math.min(1, p));
      star.style.setProperty("--sh-star-x", `${from.x + (to.x - from.x) * e}px`);
      star.style.setProperty("--sh-star-y", `${from.y + (to.y - from.y) * e}px`);
    };
    tick();

    return () => cancelAnimationFrame(raf);
  }, []);
}
