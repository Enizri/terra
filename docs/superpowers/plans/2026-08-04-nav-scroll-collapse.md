# Nav Scroll Collapse + Terra Mark Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Parker-style scroll collapse to Terra’s frosted pill nav, and replace the shuttle icon with the brand gradient rectangle.

**Architecture:** A small scroll-direction hook drives a `collapsed` boolean. The nav link group animates with Motion layout/opacity springs. A shared CSS gradient class powers both the nav/Final `TerraMark` and the hero pusher face so the wash doesn’t drift.

**Tech Stack:** React, Motion (`motion/react`), existing `terra.css`

## Global Constraints

- Keep Terra frosted pill styling (no Parker hard border/shadow)
- Collapse links only — never hide the whole nav
- Spring target: `{ type: "spring", stiffness: 500, damping: 60, mass: 1 }`
- Reduced motion: instant expand/collapse
- Mark = CSS gradient rectangle matching `.sh-hero-push__body` wash
- Touch only `web/src/terra/TerraLanding.tsx` and `web/src/terra/terra.css`
- No git commits unless explicitly requested (repo may be absent)

## File map

| File | Responsibility |
| --- | --- |
| `web/src/terra/terra.css` | Shared `--sh-terra-wash` / `.sh-terra-mark`; nav link-group collapse; Final glyph mark sizing; hero body uses shared wash |
| `web/src/terra/TerraLanding.tsx` | `TerraMark`, `useNavCollapse`, animated nav, Final glyph swap |

---

### Task 1: Shared Terra wash + mark CSS

**Files:**
- Modify: `web/src/terra/terra.css`

**Produces:**
- CSS custom property / utility for the brand gradient
- `.sh-terra-mark` (nav ~28×28, rounded)
- `.sh-final__glyph .sh-terra-mark` fills glyph box
- `.sh-hero-push__body` uses the shared wash

- [x] **Step 1: Add shared wash on `.sh-root` and mark classes**
- [x] **Step 2: Visual check** — hero pusher face still shows orange→lavender wash.

---

### Task 2: `TerraMark` + `useNavCollapse` + animated nav

**Files:**
- Modify: `web/src/terra/TerraLanding.tsx`

**Consumes:** CSS from Task 1 (`.sh-terra-mark`, `.sh-nav__links`)  
**Produces:** Working collapse + mark in nav and Final

- [x] **Step 1: Add helpers near shared UI**
- [x] **Step 2: Wire nav in `TerraLanding`**
- [x] **Step 3: Manual test** (scroll collapse + mark in browser)

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Collapse on scroll down / expand on up | Task 2 |
| Keep frosted pill | Task 2 (no style restyle) |
| Spring 500/60/1 | Task 2 `navCollapseSpring` |
| Reduced motion snap | Task 2 `duration: 0` |
| Terra gradient mark in nav + Final | Tasks 1–2 |
| Shared wash with hero | Task 1 |
| Don’t break hero sticky | Task 2 (sticky nav unchanged) |
