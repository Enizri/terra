import { Link } from "react-router-dom";
import { closing, footer } from "../data";
import { useReveal } from "../useReveal";

/** Coral closing block plus the dark footer. */
export function Final() {
  const block = useReveal();

  return (
    <>
      <section className="terra-section">
        <div ref={block}>
          <div className="terra-cta">
            <div className="terra-cta__art terra-art" aria-hidden style={{ aspectRatio: "1 / 1" }} />
            <h3 className="terra-display terra-h3--cta">{closing.title}</h3>
            <p className="terra-cta__copy">{closing.copy}</p>
            <div className="terra-cta__actions">
              <Link className="terra-pill terra-pill--fill terra-press" to="/new">
                {closing.cta}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="terra-footer">
        <div className="terra-footer__inner">
          <div className="terra-footer__top">
            <div className="terra-footer__brand">
              <p className="terra-display terra-footer__wordmark">Terra</p>
              <p className="terra-footer__tagline">{footer.tagline}</p>
            </div>
            <div className="terra-footer__cols">
              {footer.cols.map((col) => (
                <div key={col.title} className="terra-footer__col">
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
          <div className="terra-footer__base">
            <span>© {new Date().getFullYear()} Terra</span>
            <span>A human approves every merge.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
