import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <span className={styles.logo}>✳ terra</span>
        <p className={styles.tag}>
          Built with Go, Python, and a small local LLM.
        </p>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className={styles.link}
        >
          GitHub ↗
        </a>
      </div>
    </footer>
  );
}
