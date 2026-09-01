import { copy } from "../data";
import { CircleArrowIcon } from "../primitives";
// HeroDemo stays in this folder (and copy.heroDemo in data.ts) until the
// workspace-demo clip exists. Do not mount it against a missing mp4.

export function HeroChars() {
  return (
    <section className="sh-section sh-section--hero sh-section--herochars" aria-label="Hero">
      <div className="hx-grid">
        <div className="hx-copy">
          <p className="hx-eyebrow">{copy.heroEyebrow}</p>
          {/* Two-tone: the break is explicit, so `.hx-title` must not carry a
              `ch` cap or `text-wrap: balance` — both would re-wrap around it. */}
          <h1 className="hx-title">
            <span>{copy.heroHeadlineParts.lead}</span>
            <br />
            <span className="hx-title__muted">{copy.heroHeadlineParts.muted}</span>
          </h1>
          <p className="hx-body">{copy.heroSubtitle}</p>
          <div className="hx-cta">
            <a className="hx-cta__btn" href={copy.heroCta.primary.href}>
              {copy.heroCta.primary.label}
              <CircleArrowIcon />
            </a>
            <a
              className="hx-cta__btn hx-cta__btn--ghost"
              href={copy.heroCta.secondary.href}
            >
              {copy.heroCta.secondary.label}
            </a>
          </div>
        </div>

        <div className="hx-orb" aria-hidden />
      </div>
    </section>
  );
}
