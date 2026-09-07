import { TERRA_REPO_URL } from "../demo";

/** Hosted-beta notice. Rendered only in a demo build, where live preview is
 *  refused server-side and there is no shared provider key to spend. */
export function DemoBanner() {
  return (
    <aside className="sh-ws__demo" role="note">
      <b>Demo build.</b>
      <span>
        Live preview is off here — it installs and runs the analyzed
        repository&rsquo;s own code, so it stays a local-only feature. Mapping
        another repo uses your own API key.
      </span>
      <a href={`${TERRA_REPO_URL}/blob/main/docs/SECURITY.md`} target="_blank" rel="noreferrer">
        Why
      </a>
    </aside>
  );
}
