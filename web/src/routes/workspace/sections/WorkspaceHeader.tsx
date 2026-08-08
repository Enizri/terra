import { Link } from "react-router-dom";
import { ArrowIcon, DownloadIcon } from "../icons";

export function WorkspaceHeader({
  slug,
  title,
  busy,
}: {
  slug: string;
  title?: string;
  busy: boolean;
}) {
  return (
    <header className="sh-ws__head">
      <Link className="sh-ws__logo" to="/">
        <span className={`sh-terra-mark${busy ? " sh-terra-mark--spin" : ""}`} aria-hidden />
        <span>Terra</span>
      </Link>
      <span className="sh-ws__crumb">
        <b>{slug}</b>
        <em>{title || "untitled map"}</em>
      </span>
      <div className="sh-ws__chips">
        <span className="sh-chip is-disabled">
          <DownloadIcon /> Export JSON
        </span>
        <span className="sh-chip sh-chip--tint is-disabled">
          Share map <ArrowIcon />
        </span>
      </div>
    </header>
  );
}
