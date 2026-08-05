# Fullscreen theater + Terra chat dock

**Date:** 2026-08-04  
**Status:** Approved design (Approach 1)  
**Scope:** Every theater open becomes fullscreen; modern compact Terra chat dock bottom-left that expands after selection or send.

## Goal

When any diagram card opens the theater:

1. The demo fills the viewport (true fullscreen stage, not the current centered window).
2. A modern Terra chat sits bottom-left on top of the stage.
3. Chat starts **compact**; **expands** after the user selects something in the app or sends a message.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Scope | Every theater open (all cards), not frontend-only |
| Layout approach | Full-bleed stage + floating chrome (Approach 1) |
| Chat baseline | Compact dock (A) |
| Expand trigger | After selection **or** message send (B) |
| Fullscreen chat | Explicit control on the expanded dock to cover the stage |
| Files tab | Full-bleed evidence; hide chat while on Files |
| Close | Esc + ✕ chip; backdrop click optional (prefer keep Esc/✕ only so misclicks don’t dump the live session) |

## Non-goals

- Redesigning replica demos or live iframe injection
- Changing `/ask` API contract
- Building a multi-session chat history store
- Mobile-specific theater redesign beyond stacking the dock reasonably
- Restyling the landing page outside the theater

## Current behavior (baseline)

`TheaterModal` in `web/src/terra/theater.tsx`:

- Centered window `min(1100px, 94vw)` × `min(720px, 88vh)`
- Top bar: label, Live/Demo + Files tabs, Inspect (live), close
- Ask UI only appears after a selection, docked inside the window bottom
- Single-shot prompt + reply (not a message thread)

## Target behavior

### Stage

1. Theater portal covers `inset: 0`.
2. Stage (demo / live iframe / files) is full viewport; no padded modal card.
3. Floating chips top-right (and optional label chip top-left): Inspect (live+demo tab), Live/Demo, Files, Close.
4. Esc closes; body scroll locked while open.

### Chat dock (demo tab only)

**Compact (default on open):**

- Bottom-left floating card (~240–280px wide)
- Terra gradient mark + “Terra” wordmark
- Single-line composer (“Ask Terra…”) + send
- No thread yet (or empty state hidden)

**Expanded (after selection or successful send):**

- Same anchor, taller sheet (~320–360px wide, ~min(42vh, 420px) tall)
- Header: Terra mark + wordmark; collapse + **expand-to-fullscreen** controls
- Crumb when selected: `{node.label} › {selected.label}`
- Scrollable message thread (user + Terra bubbles)
- Composer pinned at bottom

**Fullscreen chat (explicit option):**

- User can expand the dock to cover the theater stage (near full viewport panel)
- Same thread + composer; header keeps a control to exit fullscreen chat back to expanded sheet (or compact)
- Stage remains mounted underneath (hidden/covered), so Inspect/Live state is preserved

**Collapse back to compact when:**

- Selection cleared and thread is empty, **or**
- User taps collapse chevron (thread retained; re-expand on next selection/send)

### Interaction with existing ask flow

- Keep live `/ask` + offline transform demo paths.
- On send: append user message → thinking state → append Terra reply; clear composer.
- Selection still drives crumb + (live) selection payload to `/ask`.
- Selecting an element while compact **expands** the dock (even before typing).

## Architecture

### Units

1. **`TheaterModal` layout** — fullscreen shell; floating chrome; body = stage.
2. **`TerraChatDock`** — compact/expanded UI; owns local `messages[]`, `expanded`, composer state; calls existing `ask` logic via props/callbacks.
3. **CSS** — `.sh-theater` fullscreen; remove window card framing for stage; `.sh-terra-chat` dock styles using `--sh-terra-wash` / Terra mark.

### Data flow

```
open TheaterModal(node)
  → fullscreen stage
  → TerraChatDock compact
selection | send
  → expand dock
  → (send) POST /ask or offline transform → append reply
Files tab
  → hide dock; show evidence full-bleed
close / Esc
  → unmount; restore body scroll
```

### Files likely touched

- `web/src/terra/theater.tsx` — layout + `TerraChatDock`
- `web/src/terra/terra.css` — fullscreen theater + chat dock styles

## Error / edge handling

- `/ask` failure: show error bubble in thread; stay expanded
- No selection + empty ask: no-op (same as today)
- Reduced motion: skip scale/slide; opacity only
- Live iframe: dock must not steal pointer events outside its box (`pointer-events` only on dock)

## Test plan

- [ ] Open Web App → fullscreen live stage; compact chat bottom-left
- [ ] Open Sign-in / Notes / etc. → same fullscreen + compact chat
- [ ] Select element → dock expands with crumb
- [ ] Send message → thread shows user + Terra reply; stays expanded
- [ ] Clear selection with empty thread (or collapse) → compact again
- [ ] Files tab → evidence full-bleed; chat hidden
- [ ] Esc / ✕ closes; page scroll restored
- [ ] Inspect toggle still works on live demo
