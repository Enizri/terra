# Workspace try-me playground + Claude-like Terra chat

**Date:** 2026-08-05  
**Status:** Approved design (Approach 2)  
**Scope:** Workspace only (`/new`, `/new/s/:slug`) — dropzone playground + `AgentDock`. Landing theater chat stays as-is.

## Goal

Make the try-me workspace feel like Terra and read clearly, and make Terra chat behave like Claude for this pass: thinking, a visible work process, and well-plotted answers — without changing the `/ask` backend yet.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Surface | Workspace only (not landing theater) |
| Visual direction | Light Claude-like (warm paper + light chat dock) |
| Chat depth | Claude-shaped UI on today’s JSON `/ask`; hooks for real streaming later |
| Layout | Keep 3-column grid (rail \| stage \| dock); restyle, don’t restructure |
| Folder drag-drop | Still unwired; URL paste remains the path in |

## Non-goals

- Restyling landing theater `TerraChatDock`
- Real NDJSON / tool-call streaming from `/ask`
- Implementing code changes in the live preview from chat
- Multi-session chat history persistence
- Wiring local folder drop onto the dropzone
- Changing analyze / map diagram layout structure

## Current behavior (baseline)

- Routes: `/new` → `/new/s/:slug` → [`Workspace.tsx`](../../../web/src/terra/Workspace.tsx)
- Empty stage: dashed dropzone + GitHub URL form + Map it ([`DropStage`](../../../web/src/terra/Workspace.tsx))
- Chat: [`AgentDock`](../../../web/src/terra/Workspace.tsx) reuses dark Cursor-like `.sh-terra-chat` from [`terra.css`](../../../web/src/terra/terra.css)
- [`useAsk`](../../../web/src/terra/useAsk.ts): one JSON `POST /ask`; messages are plain `{ role, text }`; UI shows a single “Terra is thinking” row
- Answers render as unformatted `<p>` text (no markdown)
- Styles: [`workspace.css`](../../../web/src/terra/workspace.css) for layout; shared chat chrome in `terra.css`

## Target visual language

### Workspace chrome

- Floor: warm paper `#f9f8f5` (`--sh-bg`)
- Surfaces: white / `#fafafa` (`--sh-window`)
- Ink: near-black `#111` / `#000` for primary; `#525252` muted; avoid low-contrast gray-on-gray
- Accents: CTA orange `#e8400d`; coral→lilac wash only on star mark / active thinking
- Type: keep Inter Variable; bump dropzone title weight/size contrast; body ≥14px where users read paragraphs; chat body ~14–15px / 1.5 line-height

### Dropzone (playground empty state)

- Clear hierarchy: title → one short sub → URL field → Map it
- Dashed border and placeholder text dark enough to read
- Star glow stays soft; must not wash out title text
- Focus ring stays brand orange

### Terra chat dock (workspace-scoped)

- Light shell under `.sh-ws__dock .sh-terra-chat` so theater dark skin is untouched
- Header: star mark + “Terra” (drop Cursor traffic-light chrome in workspace)
- User bubbles: soft light gray / paper tint
- Terra answers: white / near-white cards with subtle border; high-contrast ink
- Hints / crumbs: readable chips on light background
- Composer: light field, dark placeholder, clear disabled “Map a repo first” state

## Target chat behavior

### While waiting on `/ask`

Show a live assistant turn with:

1. **Thinking** — collapsible block with short staged copy (e.g. “Considering the map and selection…”). Brand wash accent on the label/mark only.
2. **Process** — ordered steps that advance while the request is in flight:
   - Reading map
   - Checking selection / files (skip or mark N/A when there is no selection)
   - Answering
3. Steps are client-driven (timers + known context: `map`, crumbs). They are **not** real tool events yet.

### When the answer arrives

- Collapse or complete thinking/process; leave completed process trail above the answer (Claude-like work log).
- Render `answer` as markdown: paragraphs, headings, lists, fenced code, inline code, bold/italic.
- Errors stay distinct (readable red on light, not muddy brown).

### Message model (forward-compatible)

Extend client messages beyond plain text, e.g.:

```ts
type AskPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; done?: boolean }
  | { type: "process"; steps: { id: string; label: string; status: "pending" | "active" | "done" | "skipped" }[] };

type AskMessage = {
  role: "user" | "terra";
  parts: AskPart[];
  error?: boolean;
};
```

`useAsk` still calls JSON `/ask`. Later, an NDJSON stream can emit the same part types without rewriting `AgentDock`.

## Implementation sketch

1. **Tokens / CSS** — Workspace-scoped light chat overrides in `workspace.css`; readability fixes on dropzone, inputs, crumbs, hints.
2. **Markdown** — Small renderer for Terra answer parts (add a light dependency or a tiny custom subset; prefer one focused package if needed).
3. **`useAsk`** — Emit user message; while busy, maintain an in-flight terra message with thinking + process parts; replace/finalize with markdown text part on response.
4. **`AgentDock`** — Render parts (thinking UI, process list, markdown body); keep selection crumbs + hint chips; free typing unchanged.
5. **Verify** — Empty dropzone contrast; mapped repo ask with/without selection; error state; reduced-motion (no wash shimmer requirement).

## Success criteria

- Dropzone and chat text are readable at a glance (no washed secondary text as body copy).
- Workspace chat reads as light Terra, not Cursor dark.
- Asking a question shows thinking + process, then a formatted answer.
- Landing theater chat appearance and behavior unchanged.
- No `/ask` API contract change.

## Open follow-ups (explicitly later)

- Real streaming thinking / tools from analyzer
- Apply the same light Claude skin to landing theater
- Wire folder drag-drop if product wants it
