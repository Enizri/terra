import { useState } from "react";
import { useReducedMotion } from "motion/react";
import { copy } from "../data";

/** Click-to-play demo card for the hero's left column.
 *
 * Deliberately NOT autoplaying. The hero already pays for a WebGL globe and a
 * scroll scrub on the same frame; a fourth decoded video stream starting on
 * load is what makes the globe stutter. A poster image costs nothing until the
 * reader asks for the video, and the click is also the signal that they want it.
 */
export function HeroDemo() {
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();

  return (
    <figure className={`hx-demo${playing ? " is-playing" : ""}${reduced ? " is-still" : ""}`}>
      {playing ? (
        <video
          className="hx-demo__video"
          src={copy.heroDemo.src}
          poster={copy.heroDemo.poster}
          controls
          // Only ever reached from a user gesture, so autoplay here is the
          // press itself — muted keeps it allowed under every autoplay policy.
          autoPlay
          muted
          playsInline
          preload="metadata"
          aria-label={copy.heroDemo.alt}
        />
      ) : (
        <button
          type="button"
          className="hx-demo__poster"
          onClick={() => setPlaying(true)}
          aria-label={copy.heroDemo.play}
        >
          <img
            className="hx-demo__still"
            src={copy.heroDemo.poster}
            alt={copy.heroDemo.alt}
            loading="lazy"
            decoding="async"
            width={1440}
            height={900}
          />
          <span className="hx-demo__play" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.2-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
            </svg>
          </span>
        </button>
      )}
      <figcaption className="hx-demo__cap">{copy.heroDemo.caption}</figcaption>
    </figure>
  );
}
