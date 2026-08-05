import { useReveal } from "../hooks/useReveal";
import styles from "./StarQuote.module.css";

export default function StarQuote() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className={styles.section}>
      <div ref={ref} className="container">
        <p className={styles.stars} aria-hidden>
          ★★★★★
        </p>
        <blockquote className={styles.quote}>
          “I stopped asking engineers to draw the architecture on a whiteboard.
          The map was already there.”
        </blockquote>
        <p className={styles.attribution}>
          Maya, product manager (illustrative)
        </p>
      </div>
    </section>
  );
}
