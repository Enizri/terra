import type { CSSProperties } from "react";
import styles from "./Intro.module.css";

// glyph, x %, size px, color, duration s, delay s — echoes the hero video's particles
const INK = (a: number) => `rgba(36, 26, 16, ${a})`;
const SPARKLES: [string, number, number, string, number, number][] = [
  ["✦", 6, 14, INK(0.5), 7, 0],
  ["＋", 13, 11, INK(0.35), 9, 2.5],
  ["✧", 20, 16, "rgba(224, 86, 127, 0.5)", 8, 1],
  ["·", 26, 18, INK(0.55), 6, 4],
  ["✦", 33, 12, "rgba(217, 165, 20, 0.55)", 10, 0.5],
  ["＋", 40, 14, INK(0.4), 7.5, 3],
  ["·", 46, 16, INK(0.45), 8.5, 5.5],
  ["✧", 53, 13, INK(0.5), 6.5, 1.8],
  ["✦", 60, 17, "rgba(224, 86, 127, 0.45)", 9.5, 4.2],
  ["＋", 66, 11, INK(0.4), 7, 2],
  ["·", 73, 15, "rgba(217, 165, 20, 0.5)", 8, 6],
  ["✧", 80, 13, INK(0.45), 9, 0.8],
  ["✦", 87, 15, INK(0.5), 7.5, 3.6],
  ["＋", 93, 12, "rgba(224, 86, 127, 0.4)", 8.5, 1.4],
  ["·", 10, 13, INK(0.35), 9.5, 6.8],
  ["✧", 37, 11, "rgba(217, 165, 20, 0.45)", 7, 5],
  ["✦", 57, 10, INK(0.4), 8, 7.4],
  ["·", 90, 14, INK(0.5), 6.5, 5.2],
];

// sparkle-only bridge between the hero video and the Terra brand section
export default function Intro() {
  return (
    <section id="how" className={styles.section}>
      <div className={styles.sparkles} aria-hidden>
        {SPARKLES.map(([g, x, s, c, d, t], i) => (
          <span
            key={i}
            style={
              {
                "--x": `${x}%`,
                "--s": `${s}px`,
                "--c": c,
                "--d": `${d}s`,
                "--t": `${t}s`,
              } as CSSProperties
            }
          >
            {g}
          </span>
        ))}
      </div>
    </section>
  );
}
