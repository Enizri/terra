import { useState } from "react";
import { faq } from "../data";
import { useReveal } from "../useReveal";

/** Sticky headline on the left, numbered accordion on the right. */
export function Faq() {
  const eyebrow = useReveal<HTMLParagraphElement>();
  const title = useReveal(60);
  const art = useReveal(160);
  const list = useReveal(120);
  // One open at a time; the first is open on load.
  const [open, setOpen] = useState(0);

  return (
    <section className="terra-section">
      <div className="terra-faq">
        <div>
          <div className="terra-faq__aside">
            <p ref={eyebrow} className="terra-eyebrow">
              {faq.eyebrow}
            </p>
            <div ref={title}>
              <h3 className="terra-display terra-h3 terra-h3--faq">{faq.title}</h3>
            </div>
            <div ref={art} className="terra-faq__art terra-art" aria-hidden style={{ aspectRatio: "1 / 1" }} />
          </div>
        </div>
        <div ref={list}>
          <div className="terra-faq__list">
            {faq.items.map((item, i) => (
              <div key={item.q} className="terra-faq__item">
                <button
                  type="button"
                  className="terra-faq__q"
                  aria-expanded={open === i}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => setOpen(open === i ? -1 : i)}
                >
                  <span className="terra-faq__n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="terra-display terra-faq__label">{item.q}</span>
                </button>
                {open === i ? (
                  <p id={`faq-a-${i}`} className="terra-faq__a">
                    {item.a}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
