import type { ClipboardEvent, DragEvent, ReactNode } from "react";
import { RepoIcon } from "./icons";

/** The workspace "Drop a GitHub repo" card; `icon` overrides the folder glyph. */
export function WsDropCard({
  over = false,
  icon,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
}: {
  over?: boolean;
  icon?: ReactNode;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onPaste?: (e: ClipboardEvent) => void;
}) {
  return (
    <div
      className={`sh-ws-drop${over ? " is-over" : ""}`}
      tabIndex={0}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <span className="sh-ws-drop__glow" aria-hidden />
      {icon ?? <RepoIcon />}
      <h1 className="sh-ws-drop__title">Drop a GitHub repo</h1>
      <p className="sh-ws-drop__sub">Terra reads the code and draws the map. No config, no setup.</p>
    </div>
  );
}
