import { useReveal } from "../hooks/useReveal";
import styles from "./CtaBanner.module.css";

export default function CtaBanner() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className={styles.section}>
      <div className="container">
        <div ref={ref} className={styles.banner}>
          <div className={styles.text}>
            <h2 className={styles.title}>
              Your codebase
              <br />
              deserves a map
            </h2>
            <p className={styles.sub}>
              Whatever your team is building, Terra is where everyone finally
              sees it.
            </p>
            <a className={`pill-btn ${styles.btn}`} href="#video">
              Explore Terra
            </a>
          </div>
          <BannerDoodle />
        </div>
      </div>
    </section>
  );
}

// Original monoline doodle: three teammates around a shared map with a flag.
function BannerDoodle() {
  return (
    <svg
      viewBox="0 0 300 170"
      className={styles.doodle}
      fill="none"
      aria-hidden
    >
      {/* map sheet */}
      <path
        d="M60 130 L120 110 L190 122 L250 104 L246 148 L186 162 L118 150 L64 160 Z"
        stroke="#3d2b13"
        strokeWidth="2.4"
        strokeLinejoin="round"
        fill="rgba(255,255,255,.55)"
      />
      <circle cx="126" cy="130" r="4.5" fill="#3d2b13" />
      <circle cx="176" cy="138" r="4.5" fill="#fff" stroke="#3d2b13" strokeWidth="1.6" />
      <path d="M131 131 C 148 137, 158 138, 171 138" stroke="#3d2b13" strokeWidth="1.6" strokeDasharray="4 4" />
      {/* flag on the map */}
      <path d="M216 84 L216 118" stroke="#3d2b13" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M216 84 L240 92 L216 101 Z" fill="#3d2b13" />
      {/* three figures */}
      <g stroke="#3d2b13" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="86" cy="52" r="12" fill="rgba(255,255,255,.55)" />
        <path d="M86 64 L86 92 M86 72 L72 82 M86 72 L100 80" />
        <circle cx="150" cy="40" r="12" fill="rgba(255,255,255,.55)" />
        <path d="M150 52 L150 84 M150 60 L136 68 M150 60 L164 68" />
        <circle cx="212" cy="52" r="12" fill="rgba(255,255,255,.55)" />
        <path d="M212 64 L212 92 M212 72 L198 80 M212 72 L226 76" />
      </g>
      {/* sparkles */}
      <path d="M48 34 l0 12 M42 40 l12 0" stroke="#3d2b13" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M262 40 C 266 36, 270 40, 274 36" stroke="#3d2b13" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
