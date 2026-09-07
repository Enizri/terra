import "../../shared/styles/tokens.css";
import "../../shared/styles/ui.css";
import "../../shared/site/site-nav.css";
import "./about.css";
import { MotionConfig } from "motion/react";
import { useLayoutEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowIcon } from "../../shared/site/marks";
import { SiteNav } from "../../shared/site/SiteNav";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About", current: true },
];

export default function AboutPage() {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const previousTitle = document.title;
    document.title = "About Terra — Understand your codebase";
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="sh-root sh-root--about">
        <SiteNav home="/" links={NAV_LINKS} />

        <main className="ab-main">
          <article className="ab-article" aria-labelledby="about-title">
            <header className="ab-header">
              <h1 id="about-title">About Terra</h1>
            </header>

            <div className="ab-introduction">
              <p>
                Terra is a workspace for understanding and working on software.
                We’re building it to help people see how a codebase fits together,
                ask better questions, and make changes with a clear understanding
                of the system around them.
              </p>
              <p>
                Working on a project often starts with finding your way through
                it. Files tell you what the code does, but the larger picture can
                take longer to uncover: where responsibilities live, how services
                connect, and what a change might affect. Terra brings that context
                into the workspace, starting with an interactive architecture map
                of your GitHub repository.
              </p>
            </div>

            <section className="ab-section" aria-labelledby="architecture-title">
              <h2 id="architecture-title">See how the project fits together</h2>
              <p>
                <em>Understanding starts with context.</em> Terra maps the main
                components of a repository and the relationships between them.
                You can explore each component, follow its connections, and open
                the source files behind it. Questions about the project are
                answered using its code and structure, with evidence you can
                examine for yourself.
              </p>
            </section>

            <section className="ab-section" aria-labelledby="building-title">
              <h2 id="building-title">Bring understanding into the work</h2>
              <p>
                The map is a starting point for building. Find the part of the
                system you want to work on, use that context to guide a change,
                and explore the result in a live preview. Our aim is to keep
                architecture, code, and running software close enough that you
                can move between them without losing your place.
              </p>
            </section>

            <section className="ab-section" aria-labelledby="team-title">
              <div className="ab-section__heading">
                <h2 id="team-title">A shared workflow for your team</h2>
                <span className="ab-coming-soon">Coming soon</span>
              </div>
              <p>
                <em>A shared project needs shared context.</em> We’re working
                toward a team workflow that brings people into the same workspace
                to understand a project, discuss changes, and build together.
                The architecture map will provide a common starting point for
                onboarding, planning, and reviewing work.
              </p>
              <p>
                The workflow we’re building connects those steps: get familiar
                with the system together, agree on an approach, explore changes
                in the live software, and review the result before a human
                approves the merge.
              </p>
            </section>

            <Link className="ab-cta" to="/new">
              Explore a repository <ArrowIcon />
            </Link>
          </article>
        </main>

        <footer className="ab-footer">
          <Link to="/" className="ab-wordmark">Terra</Link>
          <span>© {new Date().getFullYear()} Terra</span>
        </footer>
      </div>
    </MotionConfig>
  );
}
