import { footer } from "../data";

/** Dark site footer. */
export function Final() {
  return (
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
  );
}
