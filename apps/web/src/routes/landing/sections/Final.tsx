import { motion } from "motion/react";
import { inView, rise, stagger } from "../../../shared/motion";
import { copy } from "../data";
import HeroBackdrop from "../HeroBackdrop";
import { ArrowIcon, MotionLink } from "../primitives";

export function Final() {
  return (
    <motion.div
      className="sh-final"
      initial="hidden"
      whileInView="show"
      variants={stagger}
      viewport={inView}
    >
      {/* In-flow scenic star — always present, scrolls with the page. */}
      <div className="sh-final__glyph">
        <HeroBackdrop inline />
      </div>
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
