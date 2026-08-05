import { useReveal } from "../hooks/useReveal";
import styles from "./Personas.module.css";

const PERSONAS = [
  {
    who: "For product managers",
    what: "See what the system is actually made of before writing the next spec — no engineer required.",
  },
  {
    who: "For engineers new to the repo",
    what: "Skip the two-week archaeology phase. Start from the map, drill into the files that matter.",
  },
  {
    who: "For founders",
    what: "Understand what your team built and what every part costs to change.",
  },
];

export default function Personas() {
  const ref = useReveal<HTMLDivElement>({ targets: "[data-reveal]", stagger: 0.15 });

  return (
    <section className="section">
      <div ref={ref} className={`container ${styles.row}`}>
        <div data-reveal className={styles.text}>
          <h2 className="section-heading">
            Built for how
            <br />
            your team works
          </h2>
          <ul className={styles.list}>
            {PERSONAS.map((p) => (
              <li key={p.who}>
                <p className={styles.who}>✦ {p.who}</p>
                <p className={styles.what}>{p.what}</p>
              </li>
            ))}
          </ul>
        </div>

        <figure data-reveal className={`grid-card ${styles.cardFigure}`}>
          <PersonaDoodle />
          <blockquote className={styles.quote}>
            “I opened the map before my first standup and finally knew what
            everyone was talking about.”
          </blockquote>
          <figcaption className={styles.attribution}>
            Sam, engineer in week one (illustrative)
          </figcaption>
        </figure>
      </div>
      <p className={styles.footnote}>
        Illustrative scenarios — Terra is pre-launch.
      </p>
    </section>
  );
}

// Original monoline doodle: figure relaxing in a hammock strung between two
// map-pin poles, reading a small node graph.
function PersonaDoodle() {
  return (
    <svg viewBox="0 0 220 130" width="220" height="130" fill="none" aria-hidden>
      <path d="M30 30 L30 100 M190 30 L190 100" stroke="#241a10" strokeWidth="2" strokeLinecap="round" />
      <path d="M30 44 C 80 86, 140 86, 190 44" stroke="#241a10" strokeWidth="2" fill="none" />
      <circle cx="110" cy="52" r="9" stroke="#241a10" strokeWidth="2" fill="#fff" />
      <path d="M101 60 C 92 68, 84 70, 72 70 M119 60 C 128 68, 136 70, 148 70" stroke="#241a10" strokeWidth="2" strokeLinecap="round" />
      <rect x="92" y="26" width="36" height="22" rx="3" stroke="#241a10" strokeWidth="1.8" fill="#fff" transform="rotate(-8 110 37)" />
      <circle cx="102" cy="34" r="2.5" fill="#ffc53d" />
      <circle cx="118" cy="38" r="2.5" fill="#e0567f" />
      <path d="M104 35 L 115 38" stroke="#241a10" strokeWidth="1.2" />
      <path d="M46 20 q 4 -6 8 0 q 4 -6 8 0" stroke="#241a10" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M158 16 C 162 12, 166 16, 170 12" stroke="#241a10" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
