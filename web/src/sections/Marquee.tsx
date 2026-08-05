import styles from "./Marquee.module.css";

const STACKS = [
  "Go",
  "Python",
  "TypeScript",
  "React",
  "Rust",
  "SQLite",
  "PostgreSQL",
  "Docker",
  "Node.js",
  "Protocol Buffers",
  "Vite",
  "gRPC",
];

export default function Marquee({ bare = false }: { bare?: boolean }) {
  const track = [...STACKS, ...STACKS]; // duplicated for a seamless loop
  return (
    <section
      className={bare ? styles.bare : styles.marquee}
      aria-label="Supported stacks"
    >
      <p className={styles.caption}>Reads the stacks you already have</p>
      <div className={styles.viewport}>
        <div className={styles.track}>
          {track.map((s, i) => (
            <span key={`${s}-${i}`} className={styles.item} aria-hidden={i >= STACKS.length}>
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
