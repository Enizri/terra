import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStreamingAskHint } from "../../../shared/live";
/* ---------- terra chat dock ---------- */

export type ChatMessage = { role: "user" | "terra"; text: string; error?: boolean };

type ChatMode = "compact" | "sheet" | "full";

/** Imperative chat controls for the scripted hero film. */
export type ChatScriptHandle = {
  postUser(text: string): void;
  postTerra(text: string): void;
  setThinking(on: boolean): void;
  /** Typewriter text shown in the read-only prompt row; "" clears. */
  setPromptText(text: string): void;
};

/** Marketing Ask chips (Power of Terra — canned, no backend). */
export const ASK_HINTS = [
  "Explain this selection",
  "Where is this defined?",
  "What depends on this?",
  "How does this talk to the store?",
  "Show the evidence",
] as const;

/** Hardcoded Ask replies keyed by chip text — marketing demo only. */
export const DEMO_ASK_REPLIES: Record<(typeof ASK_HINTS)[number], string> = {
  "Explain this selection":
    "This is part of Memos' explore surface — the UI people use to browse notes. On the map it sits under Web App and talks to the API for every list and search.",
  "Where is this defined?":
    "Defined in the frontend tree (web/src). Terra ties the selection to that path so you can jump from the map straight into the files that own this UI.",
  "What depends on this?":
    "Explore depends on the Request Handler (API) for memo lists and tags. Upstream, Sign-in gates who can see private notes before this screen loads.",
  "How does this talk to the store?":
    "It never touches the database directly — the Web App calls the API, Notes writes memos, and Storage (terra.db / SQLite) persists them. The map edge is web → api → memos → db.",
  "Show the evidence":
    "Evidence lives on the map edges: memo_service routes, store/memo.go, and the explore feed components. Each claim links back to those files — not a guessed summary.",
};

export const DEMO_ASK_FALLBACK =
  "On the Memos map this UI belongs to Web App. It reaches Storage only through the API and Notes layers — pick another question for a tighter answer.";

/** One-shot Implement design chips (scripted preview transforms). */
export const IMPLEMENT_HINTS = [
  "Give this more breathing room",
  "Add a brand accent color",
  "Make buttons feel clickable on hover",
  "Bump the type for readability",
  "Soften the corners",
] as const;


/** Floating dock: one-shot chips after selection. */
export function TerraChatDock({
  selectionKey,
  crumb,
  onAsk,
  onHeadPointerDown,
  hints = ASK_HINTS,
  designMode = false,
  scripted = false,
  scriptRef,
  initialMessages,
  wsSkin = false,
  greeting,
}: {
  selectionKey: string | null;
  crumb: string | null;
  onAsk: (question: string) => Promise<string>;
  onHeadPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  hints?: readonly string[];
  designMode?: boolean;
  /** Scripted hero film: no chips, prompt text driven via `scriptRef`. */
  scripted?: boolean;
  scriptRef?: Ref<ChatScriptHandle>;
  initialMessages?: ChatMessage[];
  /** Workspace column look: light skin, brand head, always open. */
  wsSkin?: boolean;
  /** Opening Terra turn shown while the thread is empty (workspace dock). */
  greeting?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<ChatMode>(wsSkin ? "sheet" : "compact");
  const [usedBySel, setUsedBySel] = useState<Record<string, string[]>>({});
  const [scriptPrompt, setScriptPrompt] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const open = mode !== "compact";
  const usedForSel = selectionKey ? usedBySel[selectionKey] ?? [] : [];
  const options = selectionKey && !scripted ? hints.filter((h) => !usedForSel.includes(h)) : [];
  const optionsLabel = designMode ? "Design this component" : "Ask about this component";
  const exhaustedMsg = designMode
    ? "Every design tweak for this component is already applied. Pick another element."
    : "You've asked every question for this component. Pick another element.";
  const streaming = !scripted && !selectionKey && !thinking && hints.length > 0;
  const askHint = useStreamingAskHint(!streaming, hints);

  useImperativeHandle(scriptRef, () => ({
    postUser: (text: string) => setMessages((m) => [...m, { role: "user", text }]),
    postTerra: (text: string) => setMessages((m) => [...m, { role: "terra", text }]),
    setThinking,
    setPromptText: setScriptPrompt,
  }));

  useEffect(() => {
    if (selectionKey) {
      setMode((m) => (m === "compact" ? "sheet" : m));
      return;
    }
    setMode((m) => (messages.length ? m : "compact"));
  }, [selectionKey, messages.length]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, thinking, mode, options.length]);

  const sendOption = async (raw: string) => {
    const q = raw.trim();
    const sel = selectionKey;
    if (!q || thinking || !sel) return;
    if ((usedBySel[sel] ?? []).includes(q)) return;
    setUsedBySel((prev) => ({
      ...prev,
      [sel]: [...(prev[sel] ?? []), q],
    }));
    setMode((m) => (m === "compact" ? "sheet" : m));
    setMessages((m) => [...m, { role: "user", text: q }]);
    setThinking(true);
    try {
      const text = await onAsk(q);
      setMessages((m) => [...m, { role: "terra", text }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "terra", text: String(e), error: true }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div
      className={`sh-terra-chat ${open ? "sh-terra-chat--open" : ""} ${
        mode === "full" ? "sh-terra-chat--full" : ""
      }${wsSkin ? " sh-terra-chat--ws" : ""}`}
    >
      <div className="sh-terra-chat__head" onPointerDown={onHeadPointerDown}>
        {wsSkin ? (
          <span className="sh-ws-chat__brand">
            <span className="sh-terra-mark sh-ws-chat__mark" aria-hidden />
            <b className="sh-terra-chat__name">Terra</b>
          </span>
        ) : (
          <>
            <span className="sh-terra-chat__lights" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <b className="sh-terra-chat__name">Terra</b>
            {open && (
              <span className="sh-terra-chat__tools" data-no-drag>
                <button
                  className="sh-terra-chat__ctl"
                  onClick={() => setMode(mode === "full" ? "sheet" : "full")}
                  aria-label={mode === "full" ? "Exit chat fullscreen" : "Expand chat to fullscreen"}
                  title={mode === "full" ? "Exit fullscreen" : "Fullscreen chat"}
                >
                  {mode === "full" ? "⤡" : "⤢"}
                </button>
                <button className="sh-terra-chat__ctl" onClick={() => setMode("compact")} aria-label="Collapse chat">
                  ⌄
                </button>
              </span>
            )}
          </>
        )}
      </div>

      {/* No exit animation — a lingering body would stretch the collapsed dock. */}
      {open && (
        <div className="sh-terra-chat__body">
          {crumb &&
            (wsSkin ? (
              /* Workspace dock shows selections as droppable chips. */
              <div className="sh-ws__crumbs">
                <button type="button" className="sh-terra-chat__crumb">
                  {crumb} ×
                </button>
              </div>
            ) : (
              <span className="sh-terra-chat__crumb">{crumb}</span>
            ))}
          <div className="sh-terra-chat__thread" ref={threadRef}>
            {!scripted && selectionKey && options.length === 0 && (
              <p className="sh-terra-chat__msg sh-terra-chat__msg--terra">{exhaustedMsg}</p>
            )}
            {wsSkin && greeting && messages.length === 0 && (
              <div className="sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn">
                <p className="sh-ws-md">{greeting}</p>
              </div>
            )}
            {messages.map((m, i) =>
              wsSkin && m.role === "terra" ? (
                <div
                  className={`sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn${
                    m.error ? " sh-terra-chat__msg--error" : ""
                  }`}
                  key={i}
                >
                  <p className="sh-ws-md">{m.text}</p>
                </div>
              ) : (
                <p
                  className={`sh-terra-chat__msg sh-terra-chat__msg--${m.role} ${
                    m.error ? "sh-terra-chat__msg--error" : ""
                  }`}
                  key={i}
                >
                  {m.text}
                </p>
              ),
            )}
            {thinking &&
              (wsSkin ? (
                /* Workspace thinking row — spinning mark, no dark shimmer. */
                <div className="sh-ws-think" aria-live="polite">
                  <span className="sh-ws-think__toggle">
                    <span className="sh-terra-mark sh-terra-mark--spin sh-ws-think__mark" aria-hidden />
                    <span className="sh-ws-think__label">Thinking</span>
                  </span>
                </div>
              ) : (
                <div className="sh-terra-chat__thinking" aria-live="polite">
                  <span className="sh-terra-chat__thinking-mark" aria-hidden />
                  <span className="sh-terra-chat__thinking-label">Terra is thinking</span>
                </div>
              ))}
          </div>
          {selectionKey && options.length > 0 && !thinking && (
            <div
              className={`sh-terra-chat__hints${
                messages.length > 0 ? " sh-terra-chat__hints--compact" : ""
              }`}
              data-no-drag
            >
              {messages.length === 0 && (
                <p className="sh-terra-chat__hints-label">{optionsLabel}</p>
              )}
              {options.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="sh-terra-chat__hint"
                  onClick={() => sendOption(h)}
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Read-only prompt — free typing off; idle streams suggestion animation. */}
      {wsSkin ? (
        /* Workspace ask row — the film types into the real input. */
        <form className="sh-terra-chat__prompt sh-ws__ask" onSubmit={(e) => e.preventDefault()}>
          <input
            className="sh-ws__ask-input"
            value={scriptPrompt}
            placeholder={selectionKey ? "Ask about this selection" : "Ask about this repo"}
            aria-label="Ask Terra about this repository"
            readOnly
          />
        </form>
      ) : (
      <div className="sh-terra-chat__prompt" data-no-drag aria-live="polite">
        {scripted ? (
          scriptPrompt ? (
            <span className="sh-terra-chat__stream">
              {scriptPrompt}
              <i className="sh-terra-chat__caret" />
            </span>
          ) : (
            "Ask Terra about this component"
          )
        ) : streaming ? (
          <span className="sh-terra-chat__stream">
            {askHint.text}
            <i className="sh-terra-chat__caret" />
          </span>
        ) : selectionKey ? (
          options.length > 0 ? (
            optionsLabel
          ) : (
            "Pick another component"
          )
        ) : (
          designMode ? "Select a component to redesign" : "Select a component to ask about"
        )}
      </div>
      )}
    </div>
  );
}
