import { useEffect, useState } from "react";
import { renderMarkdown } from "../../../shared/markdown";
import type { AskMessage, AskPart } from "../useAsk";

/** The model's reasoning: open while it streams, folded away once it lands. */
function ThinkingPart({ part }: { part: Extract<AskPart, { type: "thinking" }> }) {
  const [open, setOpen] = useState(!part.done);
  useEffect(() => {
    if (part.done) setOpen(false);
  }, [part.done]);

  return (
    <div className={`sh-ws-think${part.done ? " is-done" : ""}`}>
      <button
        type="button"
        className="sh-ws-think__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sh-terra-mark sh-ws-think__mark" aria-hidden />
        <span className="sh-ws-think__label">{part.done ? "Thought" : "Thinking"}</span>
        <span className="sh-ws-think__chev" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <p className="sh-ws-think__body">{part.text}</p>}
    </div>
  );
}

function ProcessPart({ part }: { part: Extract<AskPart, { type: "process" }> }) {
  return (
    <ol className="sh-ws-process" aria-label="Work in progress">
      {part.steps.map((step) => (
        <li key={step.id} className={`sh-ws-process__step is-${step.status}`} data-status={step.status}>
          <span className="sh-ws-process__dot" aria-hidden />
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One turn in the thread. A new part kind from /ask is a case here and nothing
 * else — the dock never looks inside a message.
 */
export function MessageParts({ message }: { message: AskMessage }) {
  if (message.role === "user") {
    const text = message.parts.find((p) => p.type === "text");
    return (
      <div className="sh-terra-chat__msg sh-terra-chat__msg--user">
        {text && text.type === "text" ? text.text : null}
      </div>
    );
  }

  return (
    <div
      className={`sh-terra-chat__msg sh-terra-chat__msg--terra sh-ws-turn${
        message.error ? " sh-terra-chat__msg--error" : ""
      }`}
    >
      {message.parts.map((part, i) => {
        if (part.type === "thinking") return <ThinkingPart key={i} part={part} />;
        if (part.type === "process") return <ProcessPart key={i} part={part} />;
        if (part.type === "text") {
          return (
            <div
              key={i}
              className="sh-ws-md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
