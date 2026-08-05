# Fullscreen Theater + Terra Chat Dock Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fullscreen theater for every card open, with a compact bottom-left Terra chat dock that expands after selection or send.

**Architecture:** Refactor `TheaterModal` to a full-bleed stage + floating chrome chips. Extract `TerraChatDock` for compact/expanded chat over the stage (demo tab only). Keep existing `/ask` + offline transform logic.

**Tech Stack:** React, Motion, existing `terra.css` / `--sh-terra-wash`

## Global Constraints

- Touch primarily `web/src/terra/theater.tsx` and `web/src/terra/terra.css`
- Do not change `/ask` API or live iframe injection
- No Parker restyle of landing nav
- Close via Esc + ✕ only (no backdrop dismiss)
- Hide chat on Files tab
- Match design: `docs/superpowers/specs/2026-08-04-fullscreen-theater-chat-design.md`
- No git commits unless asked

## File map

| File | Responsibility |
| --- | --- |
| `theater.tsx` | Fullscreen shell, floating chrome, `TerraChatDock`, wire selection/ask |
| `terra.css` | Fullscreen theater + `.sh-terra-chat*` dock styles |

---

### Task 1: Fullscreen theater shell + floating chrome

**Files:** Modify `theater.tsx`, `terra.css`

- [x] Make `.sh-theater` full viewport stage (no centered card window)
- [x] Stage (demo/live/files) fills `inset: 0`
- [x] Floating chips: label (top-left), Inspect / Live|Demo / Files / Close (top-right)
- [x] Remove backdrop click-to-close; keep Esc + ✕
- [x] Live iframe / replicas fill stage (`.sh-live`, `.sh-replica` height 100%)

### Task 2: TerraChatDock compact → expand

**Files:** Modify `theater.tsx`, `terra.css`

- [x] Add `TerraChatDock` with Terra mark (`--sh-terra-wash`), compact composer
- [x] Expand on selection or send; message thread (user + Terra bubbles)
- [x] Explicit control to expand chat to fullscreen over the stage; exit back to sheet/compact
- [x] Collapse via chevron (retain thread) or clear selection when thread empty
- [x] Wire live `/ask` + offline transforms into thread replies
- [x] Show dock only on demo tab; pointer-events only on dock
- [x] Thinking state in thread; errors as Terra bubbles

### Task 3: Smoke check

- [x] Typecheck passes
- [x] Manual: open any card → fullscreen + compact chat; select → expand; send → reply; Files hides chat; Esc closes
