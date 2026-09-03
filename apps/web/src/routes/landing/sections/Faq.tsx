import { useState } from "react";
import { faq } from "../data";
import { TerraMark } from "../primitives";
import { useRevealGroup } from "../useReveal";

/** Sticky headline on the left, numbered accordion on the right. The
 *  active row hangs a TerraMark and unrolls its answer the same way the
 *  Power capability list does — CSS grid `0fr → 1fr`, so height plays in
 *  both directions without measuring. */
export function Faq() {
  // One sequence for the whole section: eyebrow, headline, then the
  // questions in order. Tighter than the default so the list arrives as a
  // cascade rather than a set of pops.
  const reveal = useRevealGroup<HTMLElement>(70, 22);
  // One open at a time; the first is open on load. Re-clicking the open
  // row keeps it open so a star is always visible.
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="terra-section" ref={reveal}>
      <div className="terra-faq">
        <div>
          <div className="terra-faq__aside">
            <p data-reveal className="terra-eyebrow">
              {faq.eyebrow}
            </p>
            <div data-reveal>
              <h3 className="terra-display terra-h3 terra-h3--faq">{faq.title}</h3>
            </div>
            <div
              className="terra-faq__art terra-art"
              aria-hidden
              style={{ aspectRatio: "1 / 1" }}
            />
          </div>
        </div>
        <div>
          <div className="terra-faq__list">
            {faq.items.map((item, i) => (
              <div
                data-reveal
                key={item.q}
                className={`terra-faq__item${open === i ? " is-open" : ""}`}
              >
                <TerraMark className="terra-faq__mark" />
                <button
                  type="button"
                  className="terra-faq__q"
                  aria-expanded={open === i}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => setOpen(i)}
                >
                  <span className="terra-faq__n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="terra-display terra-faq__label">{item.q}</span>
                </button>
                <div className="terra-faq__reveal">
                  <div className="terra-faq__reveal-inner">
                    <p id={`faq-a-${i}`} className="terra-faq__a">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
