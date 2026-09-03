import { useEffect, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { ArrowIcon } from "./icons";

/** The repo intake field. Two instances live at once — one in the empty
 *  stage, one in the header once a map is up — so each owns its own text and
 *  the caller normalises whatever comes back. `shared/` cannot reach the
 *  route's GitHub URL parser, which is why this hands up the raw string. */
export function RepoForm({
  onSubmit,
  busy,
  compact,
  seed,
  label,
  submitLabel,
  children,
  onPaste,
}: {
  onSubmit: (raw: string) => void;
  busy: boolean;
  /** Header skin: one row, no button label, sized to the chrome. */
  compact?: boolean;
  /** Fills the field when a drop supplies the repo instead of the keyboard. */
  seed?: string;
  label: string;
  submitLabel?: string;
  children?: ReactNode;
  onPaste?: (e: ClipboardEvent) => void;
}) {
  const [url, setUrl] = useState(seed ?? "");
  useEffect(() => {
    if (seed) setUrl(seed);
  }, [seed]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const repo = url.trim();
    if (!repo || busy) return;
    onSubmit(repo);
  };

  return (
    <form className={`sh-ws__url${compact ? " sh-ws__url--compact" : ""}`} onSubmit={submit}>
      <input
        className="sh-ws__input"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onPaste={onPaste}
        placeholder="github.com/terra/terra"
        aria-label={label}
        spellCheck={false}
        disabled={busy}
      />
      <button className="sh-btn" type="submit" disabled={busy} aria-label={submitLabel ?? "Map it"}>
        {!compact && <span>{busy ? "Mapping…" : (submitLabel ?? "Map it")}</span>}
        <ArrowIcon />
      </button>
      {children}
    </form>
  );
}
