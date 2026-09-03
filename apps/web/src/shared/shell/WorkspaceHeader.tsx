import { Link } from "react-router-dom";
import { ArrowIcon, DockIcon, DownloadIcon, RailIcon } from "./icons";
import { RepoForm } from "./RepoForm";

export function WorkspaceHeader({
  slug,
  title,
  busy,
  mapped,
  railOpen,
  dockOpen,
  onToggleRail,
  onToggleDock,
  onRepo,
}: {
  slug: string;
  title?: string;
  busy: boolean;
  /** A map is on stage, so the intake field belongs up here, not under it. */
  mapped: boolean;
  railOpen: boolean;
  dockOpen: boolean;
  onToggleRail: () => void;
  onToggleDock: () => void;
  onRepo: (raw: string) => void;
}) {
  return (
    <header className="sh-ws__head">
      <button
        type="button"
        className={`sh-ws__panel-btn${railOpen ? " is-on" : ""}`}
        aria-pressed={railOpen}
        aria-label={railOpen ? "Collapse the files rail" : "Expand the files rail"}
        title={railOpen ? "Collapse the files rail" : "Expand the files rail"}
        onClick={onToggleRail}
      >
        <RailIcon />
      </button>
      <Link className="sh-ws__logo" to="/">
        <span className={`sh-terra-mark${busy ? " sh-terra-mark--spin" : ""}`} aria-hidden />
        <span>Terra</span>
      </Link>
      <span className="sh-ws__crumb">
        <b>{slug}</b>
        <em>{title || "untitled map"}</em>
      </span>

      {mapped && (
        <RepoForm
          compact
          busy={busy}
          onSubmit={onRepo}
          label="Map another GitHub repository"
          submitLabel="Map another repo"
        />
      )}

      <div className="sh-ws__chips">
        <span className="sh-chip is-disabled">
          <DownloadIcon /> Export JSON
        </span>
        <span className="sh-chip sh-chip--tint is-disabled">
          Share map <ArrowIcon />
        </span>
        <button
          type="button"
          className={`sh-ws__panel-btn${dockOpen ? " is-on" : ""}`}
          aria-pressed={dockOpen}
          aria-label={dockOpen ? "Hide the Ask panel" : "Show the Ask panel"}
          title={dockOpen ? "Hide the Ask panel" : "Show the Ask panel"}
          onClick={onToggleDock}
        >
          <DockIcon />
        </button>
      </div>
    </header>
  );
}
