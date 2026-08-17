/** Live-preview iframe + selection shapes posted by select.js. */
import { useEffect, useState, type RefObject } from "react";
import { preview } from "./api.ts";

/** Shape select.js posts on click. */
export type LiveSelection = {
  name?: string;
  ownerChain?: string[];
  file?: string;
  line?: number | null;
  tag?: string;
  text?: string;
};

export function selectionLabel(sel: LiveSelection): string {
  return sel.name ?? sel.tag ?? "element";
}

export function liveSelectionId(sel: LiveSelection): string {
  return [sel.name ?? "", sel.file ?? "", String(sel.line ?? ""), sel.tag ?? "", (sel.text ?? "").slice(0, 40)].join("|");
}

export function LiveFrame({
  picking,
  frameRef,
  repoUrl,
}: {
  picking: boolean;
  frameRef: RefObject<HTMLIFrameElement | null>;
  repoUrl: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    preview(repoUrl, ac.signal)
      .then(setUrl)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ac.abort();
  }, [repoUrl]);

  const sendMode = () => {
    frameRef.current?.contentWindow?.postMessage({ type: "terra:mode", picking }, "*");
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(sendMode, [picking]);

  if (error) return <div className="sh-live__status sh-live__status--error">Preview failed: {error}</div>;
  if (!url) return <div className="sh-live__status">Starting the dev server… first run can take a few minutes.</div>;
  return <iframe ref={frameRef} className="sh-live" src={url} onLoad={sendMode} title="Live preview" />;
}
