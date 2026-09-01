import { Link } from "react-router-dom";
import { footer, IMG } from "../data";
import { CircleArrowIcon } from "../primitives";

function hrefFor(link: string) {
  return link === "Get started" ? "/new" : "#";
}

/** Closing card: headline and CTA over the docked globe, links along the floor. */
export function Final() {
  return (
    <footer className="terra-finale">
      <div className="terra-finale__floor gx-journey__footer-dock" aria-hidden>
        <img
          className="terra-finale__sky"
          src={`${IMG}/finale-sky.jpg`}
          alt=""
        />
        {/* Same sky, masked to the painted sun and blurred hard: the sharp
            disc falls out of focus so the watchers read as looking at our
            3D globe, not the photo's orb. GlobeJourney parks it on the sun. */}
        <div className="terra-finale__sun">
          <img
            className="terra-finale__sky"
            src={`${IMG}/finale-sky.jpg`}
            alt=""
          />
        </div>
        {/* Warm spill from the sphere into the night sky, sized to the globe
            by GlobeJourney so the light grows with it. */}
        <div className="terra-finale__glow" />
      </div>
      {/* Distance haze: the scene's own lit air, drawn over the sphere but
          under the foreground, so the globe hangs deep in the sky instead of
          on the glass. GlobeJourney centres it on the globe. */}
      <div className="terra-finale__haze" aria-hidden />
      {/* The same photo again, masked to its lower band and stacked over the
          3D globe: the terrace and its watchers paint in front, so the sphere
          rises out from behind the foreground instead of over it. */}
      <div className="terra-finale__fore" aria-hidden>
        <img
          className="terra-finale__sky"
          src={`${IMG}/finale-sky.jpg`}
          alt=""
          aria-hidden
        />
      </div>
      <div className="terra-finale__chrome">
        <div className="terra-finale__hero">
          <h2 className="terra-finale__title">
            {footer.headline[0]}
            <br />
            {footer.headline[1]}
          </h2>
          <Link className="terra-finale__cta" to={footer.cta.href}>
            {footer.cta.label}
            <CircleArrowIcon />
          </Link>
        </div>
        <div className="terra-finale__cols">
          {footer.cols.map((col) => (
            <div key={col.title} className="terra-finale__col">
              <h4>{col.title}</h4>
              {col.links.map((link) =>
                hrefFor(link).startsWith("/") ? (
                  <Link key={link} to={hrefFor(link)}>
                    {link}
                  </Link>
                ) : (
                  <a key={link} href={hrefFor(link)}>
                    {link}
                  </a>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="terra-finale__base">
        <span className="terra-finale__wordmark">Terra</span>
        <span>© {new Date().getFullYear()} Terra. A human approves every merge.</span>
      </div>
    </footer>
  );
}
