import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Component, TerraMap } from "../../../shared/map/types";
import type { Selection } from "../../../shared/api";
import {
  liveSelectionId,
  selectionLabel,
  useFloatingDrag,
  useStreamingAskHint,
  type LiveSelection,
} from "../../../shared/live";
import { useAsk } from "../useAsk";
import { MessageParts } from "./messages";

/**
 * One-shot follow-ups offered once something is selected. Real questions
 * answered by /ask — the landing's Implement hints are scripted CSS tweaks and
 * would fabricate an answer here.
 */
const SELECTION_HINTS = [
  "Explain this selection",
  "Where would I make a change here?",
  "What breaks if I change it?",
  "What depends on this?",
  "Show the evidence",
];

/**
 * Terra's chat for the mapped repo. Wears theater.tsx's TerraChatDock classes
 * but is its own component: that one is unexported and welded to
 * selectionKey / onAsk / live-preview state. Workspace skins it light.
 */
export function AgentDock({
  map,
  selected,
  elements,
  onDropComponent,
  onDropElement,
}: {
  map: TerraMap | null;
  /** Cards clicked on the map, oldest first — the last one is the subject. */
  selected: Component[];
  /** Elements picked inside the live preview, if it is open. */
  elements: LiveSelection[];
  onDropComponent: (id: string) => void;
  onDropElement: (el: LiveSelection) => void;
}) {
  const repoUrl = map?.project.repository_url ?? null;
  const { messages, ask, thinking } = useAsk(repoUrl);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  // Same gesture as the theater's chat: transform-only drag, clamped to the arena.
  const { shellRef, onHeadPointerDown, onPointerMove, endGesture } = useFloatingDrag(dockRef);

  useEffect(() => setUsed(new Set()), [repoUrl]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, thinking]);

  // qa.py JSON-dumps these straight into the prompt. `file` is the one key the
  // Go side reads by name — it's what unlocks the source snippet.
  const crumbs = [
    ...selected.map((c) => ({
      key: `c:${c.id}`,
      label: c.name,
      drop: () => onDropComponent(c.id),
      payload: {
        component_id: c.id,
        name: c.name,
        type: c.type,
        purpose: c.purpose,
        tech: c.tech,
        files: c.files,
        file: c.files[0],
      } as Selection,
    })),
    ...elements.map((el) => ({
      key: `e:${liveSelectionId(el)}`,
      label: selectionLabel(el),
      drop: () => onDropElement(el),
      payload: { ...el } as Selection,
    })),
  ];
  const selections = crumbs.map((c) => c.payload);
  const primary = selections[selections.length - 1];
  const hasSelection = crumbs.length > 0;

  const send = (q: string) => {
    if (!q.trim() || thinking) return;
    setUsed((prev) => new Set(prev).add(q));
    ask(q, primary, selections);
  };

  // Power theater style: stream suggestions in the prompt while idle (no
  // selection). Chips appear only after a card/element is picked.
  const streamHints = map && !hasSelection
    ? map.suggested_questions.filter((q) => !used.has(q))
    : [];
  const streaming = Boolean(map) && !thinking && draft.length === 0 && streamHints.length > 0;
  const askHint = useStreamingAskHint(!streaming, streamHints);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Empty + streaming → accept the current suggestion (quick ask).
    const q = draft.trim() || (streaming ? askHint.full : "");
    if (!q) return;
    send(q);
    setDraft("");
  };

  const onPromptKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab" && streaming && askHint.full) {
      e.preventDefault();
      setDraft(askHint.full);
    }
  };

  // One-shot chips only after a selection — same gate as the Power dock.
  const chips = map && hasSelection
    ? SELECTION_HINTS.filter((q) => !used.has(q))
    : [];

  return (
    <div className="sh-ws__dock" ref={dockRef}>
      <div
        className="sh-terra-chat sh-terra-chat--open sh-terra-chat--ws"
        ref={shellRef}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      >
        <div className="sh-terra-chat__head" onPointerDown={onHeadPointerDown}>
          <span className="sh-ws-chat__brand">
            <span className="sh-terra-mark sh-ws-chat__mark" aria-hidden />
            <b className="sh-terra-chat__name">Terra</b>
          </span>
        </div>
        <div className="sh-terra-chat__body">
          {crumbs.length > 0 && (
            <div className="sh-ws__crumbs">
              {crumbs.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="sh-terra-chat__crumb"
                  onClick={c.drop}
                  title="Drop from the question"
                >
                  {c.label} ×
                </button>
              ))}
            </div>
          )}
          <div className="sh-terra-chat__thread" ref={threadRef}>
            {messages.length === 0 && (
              <div className="sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn">
                <p className="sh-ws-md">
                  {map
                    ? `${map.project.name} is mapped. Click any box for its purpose, tech and files — shift-click to ask about several at once.`
                    : "Drop a repo and I'll answer questions about it — what talks to what, where a change lands, why a part exists."}
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageParts key={i} message={m} />
            ))}
          </div>
          {chips.length > 0 && (
            <div className="sh-terra-chat__hints">
              <p className="sh-terra-chat__hints-label">Ask or implement</p>
              {chips.map((q) => (
                <button
                  className="sh-terra-chat__hint"
                  key={q}
                  type="button"
                  disabled={thinking}
                  onClick={() => send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
        <form
          className={`sh-terra-chat__prompt sh-ws__ask${streaming ? " is-streaming" : ""}`}
          onSubmit={submit}
        >
          {streaming && (
            <span className="sh-terra-chat__stream sh-ws__ask-stream" aria-hidden>
              {askHint.text}
              <i className="sh-terra-chat__caret" />
            </span>
          )}
          <input
            className="sh-ws__ask-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onPromptKeyDown}
            placeholder={
              streaming
                ? ""
                : !map
                  ? "Map a repo first"
                  : hasSelection
                    ? "Ask about this selection"
                    : "Ask about this repo"
            }
            aria-label="Ask Terra about this repository"
            disabled={!map || thinking}
          />
        </form>
      </div>
    </div>
  );
}
