import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "./CardStack.module.css";

const CARDS = [
  {
    title: "Scan any repo",
    body: "Paste a GitHub URL — Terra clones and reads it, no setup needed.",
    bg: "var(--pastel-blue)",
    rot: -4,
    doodle: <ScanDoodle />,
  },
  {
    title: "A graph with receipts",
    body: "Every relationship cites the exact files that prove it.",
    bg: "var(--yellow)",
    rot: 3,
    doodle: <ReceiptDoodle />,
  },
  {
    title: "A map, not a wall of text",
    body: "Nine boxes you can hold in your head instead of a thousand files.",
    bg: "var(--pastel-pink)",
    rot: -3,
    doodle: <MapDoodle />,
  },
  {
    title: "Plain-language answers",
    body: "Each component explains what it does — for the whole team.",
    bg: "var(--paper)",
    rot: 4,
    doodle: <SpeechDoodle />,
  },
];

export default function CardStack() {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(`.${styles.card}`, {
        y: 90,
        opacity: 0,
        rotation: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.16,
        scrollTrigger: { trigger: ref.current, start: "top 70%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    <section id="why" className="section">
      <div className="container">
        <h2 className="section-heading section-heading--center">
          Stop shipping docs nobody reads
        </h2>
        <div ref={ref} className={styles.stack}>
          {CARDS.map((c) => (
            <article
              key={c.title}
              className={styles.card}
              style={{ background: c.bg, rotate: `${c.rot}deg` }}
            >
              <div className={styles.doodle}>{c.doodle}</div>
              <h3 className={styles.cardTitle}>{c.title}</h3>
              <p className={styles.cardBody}>{c.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ScanDoodle() {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" fill="none" aria-hidden>
      <rect x="30" y="12" width="60" height="56" rx="6" stroke="#241a10" strokeWidth="2" fill="#fff" />
      <path d="M40 28 h40 M40 40 h28 M40 52 h34" stroke="#241a10" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="88" cy="58" r="14" stroke="#241a10" strokeWidth="2" fill="rgba(255,255,255,.8)" />
      <path d="M98 68 L108 78" stroke="#241a10" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ReceiptDoodle() {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" fill="none" aria-hidden>
      <path d="M40 8 h44 v58 l-7 6 -7 -6 -8 6 -8 -6 -7 6 -7 -6 Z" stroke="#241a10" strokeWidth="2" strokeLinejoin="round" fill="#fff" />
      <path d="M50 24 h24 M50 34 h24 M50 44 h16" stroke="#241a10" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M50 55 l6 6 l12 -12" stroke="#e0567f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MapDoodle() {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" fill="none" aria-hidden>
      <path d="M20 66 L44 54 L76 62 L102 50 L100 20 L74 30 L46 22 L22 34 Z" stroke="#241a10" strokeWidth="2" strokeLinejoin="round" fill="#fff" />
      <circle cx="46" cy="42" r="4.5" fill="#ffc53d" stroke="#241a10" strokeWidth="1.5" />
      <circle cx="74" cy="46" r="4.5" fill="#fff" stroke="#241a10" strokeWidth="1.5" />
      <path d="M51 43 C 60 46, 63 46, 69 46" stroke="#241a10" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}

function SpeechDoodle() {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" fill="none" aria-hidden>
      <path d="M28 16 h64 a8 8 0 0 1 8 8 v24 a8 8 0 0 1 -8 8 h-38 l-14 14 v-14 h-12 a8 8 0 0 1 -8 -8 v-24 a8 8 0 0 1 8 -8 Z" stroke="#241a10" strokeWidth="2" strokeLinejoin="round" fill="#fff" />
      <path d="M38 32 h44 M38 42 h30" stroke="#241a10" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
