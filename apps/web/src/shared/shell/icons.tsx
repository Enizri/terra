/** Workspace inline glyphs. */

export function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3.5" y="7.5" width="9" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7.5V5.5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v7M5 7.5L8 10.5l3-3M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RepoIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden className="sh-ws-drop__icon">
      <path
        d="M11 9.5h13.5l3.5 4.5H37a2.5 2.5 0 012.5 2.5v20A2.5 2.5 0 0137 39H11a2.5 2.5 0 01-2.5-2.5V12A2.5 2.5 0 0111 9.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M24 20v10M19.5 25.5L24 30l4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Panel toggles — the filled edge is the panel the button hides or shows. */
export function RailIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.25 3.25v9.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.25 4.85a1.6 1.6 0 011.6-1.6h2.4v9.5h-2.4a1.6 1.6 0 01-1.6-1.6z" fill="currentColor" opacity=".28" />
    </svg>
  );
}

export function DockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.75 3.25v9.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.75 3.25h2.4a1.6 1.6 0 011.6 1.6v6.3a1.6 1.6 0 01-1.6 1.6h-2.4z" fill="currentColor" opacity=".28" />
    </svg>
  );
}

/** Rail section glyphs — the only thing left when the rail is collapsed. */
export function FilesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4.25A1.25 1.25 0 013.75 3h2.4l1.1 1.5h5A1.25 1.25 0 0113.5 5.75v6A1.25 1.25 0 0112.25 13h-8.5A1.25 1.25 0 012.5 11.75z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HistoryIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M2.9 8a5.1 5.1 0 105.1-5.1A5.08 5.08 0 004.1 4.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M2.4 2.4v2.4h2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7.2" cy="7.2" r="3.9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
