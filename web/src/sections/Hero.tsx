import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import Marquee from "./Marquee";
import styles from "./Hero.module.css";

// Grid-paper hero: serif slogan over the butterfly bg video, one CTA.

export default function Hero() {
  const ref = useRef<HTMLDivElement>(null);

  // Soft entrance: fade + rise, staggered top to bottom.
  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from("[data-rise]", {
        y: 28,
        opacity: 0,
        duration: 1.1,
        ease: "power3.out",
        stagger: 0.12,
        delay: 0.15,
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={styles.root}>
      <video
        className={styles.bgVideo}
        autoPlay
        muted
        loop
        playsInline
        src="/videos/hero-bg.mp4"
      />

      <nav className={styles.nav}>
        <a className={styles.logo} href="#" aria-label="Terra">
          ✳ terra
        </a>
        <div className={styles.navCenter}>
          <a href="#">Pricing</a>
          <a href="#">About us</a>
          <a href="#">Platform</a>
          <a href="#">Resources</a>
        </div>
        <a className={styles.navCta} href="#">
          Start free trial
        </a>
      </nav>

      <section className={styles.hero}>
        <h1 data-rise className={styles.title}>
          The map that thinks
          <br />
          with your codebase
        </h1>

        <p data-rise className={styles.sub}>
          No setup. Works with any GitHub repository. Built for whole teams,
          not just engineers.
        </p>

        <div data-rise>
          <a className={styles.cta} href="#">
            Try Terra free
          </a>
        </div>

        <div data-rise className={styles.stackRow}>
          <Marquee bare />
        </div>
      </section>
    </div>
  );
}

