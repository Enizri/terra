import { Link } from "react-router-dom";
import { closing, footer } from "../data";
import { useReveal } from "../useReveal";

/** Coral closing block plus the dark footer. */
export function Final() {
  const block = useReveal();

  return (
    <>
      <section className="hl-section">
        <div ref={block}>
          <div className="hl-cta">
            <div className="hl-cta__art hl-art" aria-hidden style={{ aspectRatio: "1 / 1" }} />
            <h3 className="hl-display hl-h3--cta">{closing.title}</h3>
            <p className="hl-cta__copy">{closing.copy}</p>
            <div className="hl-cta__actions">
              <Link className="hl-pill hl-pill--fill hl-press" to="/new">
                {closing.cta}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="hl-footer">
        <div className="hl-footer__inner">
          <div className="hl-footer__top">
            <div className="hl-footer__brand">
              <p className="hl-display hl-footer__wordmark">Terra</p>
              <p className="hl-footer__tagline">{footer.tagline}</p>
            </div>
            <div className="hl-footer__cols">
              {footer.cols.map((col) => (
                <div key={col.title} className="hl-footer__col">
                  <h4>{col.title}</h4>
                  {col.links.map((link) => (
                    <a key={link} href="#">
                      {link}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="hl-footer__base">
            <span>© {new Date().getFullYear()} Terra</span>
            <span>A human approves every merge.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
