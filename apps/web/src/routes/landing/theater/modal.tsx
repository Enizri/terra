import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import type { DiagramNode } from "../data";
import { TheaterPanel } from "./panel";
/* ---------- fullscreen escalation ---------- */

/** Fullscreen theater portal. */
export function TheaterModal({ node, onClose }: { node: DiagramNode; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return createPortal(
    <motion.div
      className="sh-theater sh-theater--full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <TheaterPanel node={node} onClose={onClose} />
    </motion.div>,
    document.body,
  );
}
