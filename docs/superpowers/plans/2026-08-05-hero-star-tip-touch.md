# Hero Star Tip-Touch Word Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the hero backdrop star closer and slightly down so a spoke tip visibly touches the **E** of `engineers`, then keep the existing spin-synced drag that replaces it with `humans`.

**Architecture:** Approach A from the spec — change only the hero CSS translate defaults (`--sh-star-x` / `--sh-star-y`) and the parked offset. Leave `HeroTitle` spoke grab/drag/ride logic, star size, mid-page side-swaps, and Final dock alone unless a visual miss forces a tiny `PRIME_LEAD_DEG` tweak.

**Tech Stack:** Existing CSS custom properties on `.sh-backdrop`; React + Motion word swap already in `TerraLanding.tsx` (no new libraries).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-05-hero-star-tip-touch-design.md`
- Approach A only — no drawn spoke line, no JS auto-placement, no hero size change
- Hero size stays `min(50.4vh, 72vw, 420px)`
- Final dock and mid-page `±26vw` / `STAR_SECTION_DROP_VH` path unchanged
- Target hero defaults: `--sh-star-x: -12vw`, `--sh-star-y: 7vh`
- Target parked: `--sh-star-x: -18vw`
- Allowed visual tune after check: ±2vw / ±2vh on those three values only
- Touch preferably only `web/src/terra/terra.css`; `TerraLanding.tsx` only if tip still misses after nudge
- No git commits unless explicitly requested (repo may be absent)

## File map

| File | Responsibility |
| --- | --- |
| `web/src/terra/terra.css` | Hero `--sh-star-x/y` defaults on `.sh-backdrop`; parked `--sh-star-x` on `.sh-backdrop--parked` |
| `web/src/terra/TerraLanding.tsx` | Optional only: tiny `PRIME_LEAD_DEG` (or related) tweak if tip overshoots/undershoots after CSS nudge |
| `web/src/terra/HeroBackdrop.tsx` | **Do not modify** — rotation consumer only |

---

### Task 1: Hero + parked CSS nudge

**Files:**
- Modify: `web/src/terra/terra.css` (`.sh-backdrop` translate defaults ~lines 279–281; `.sh-backdrop--parked` ~lines 307–310)

**Interfaces:**
- Consumes: existing `translate: var(--sh-star-x, …) var(--sh-star-y, …)` on `.sh-backdrop`
- Produces: new hero defaults `-12vw` / `7vh`; parked `-18vw`

- [ ] **Step 1: Update `.sh-backdrop` default translate vars**

Replace the default fallbacks so the hero star sits closer (right) and a bit down:

```css
.translate: var(--sh-star-x, -12vw) var(--sh-star-y, 7vh);
```

Keep the comment above accurate — note hero defaults are closer/down for tip-on-**E** contact; parked / section observer still override.

- [ ] **Step 2: Update `.sh-backdrop--parked`**

```css
.sh-backdrop--parked {
  --sh-star-x: -18vw;
}
```

Do **not** set `--sh-star-y` on parked unless the visual check shows the post-swap star sits oddly high; y should stay at the hero `7vh` default so park is a horizontal drift only.

- [ ] **Step 3: Visual check (hard reload)**

Run: open `http://127.0.0.1:5173/` (or current Vite port), hard reload.

Expected:
1. Before swap: a spoke tip meets / nearly meets the **E** of `engineers`.
2. Spin drags `engineers` down; trailing spoke brings `humans` in.
3. After settle: star drifts left to ~`-18vw` (parked), still at ~`7vh` vertical.
4. Scroll mid-page: side swaps still use `±26vw` + section drop (unchanged).
5. Final section: docked glyph size/position unchanged.

If tip still misses by a little: nudge within ±2vw / ±2vh only (e.g. `-10vw` / `8vh`), re-reload, stop when contact reads physical.

- [ ] **Step 4: Commit (only if user asked and git exists)**

```bash
git add web/src/terra/terra.css
git commit -m "$(cat <<'EOF'
Nudge hero star closer so a spoke tip meets Engineers.

EOF
)"
```

Skip if no `.git` or user did not request a commit.

---

### Task 2: Optional grab-lead tweak (only if tip still wrong after Task 1)

**Files:**
- Modify: `web/src/terra/TerraLanding.tsx` (`PRIME_LEAD_DEG` near line 648) — **skip entire task if Task 1 visual check already looks realistic**

**Interfaces:**
- Consumes: CSS position from Task 1; existing `arm()` / spoke-gap grab
- Produces: slightly earlier/later grab relative to tip sweep

- [ ] **Step 1: Decide whether this task is needed**

If after Task 1 the tip visibly touches the **E** and the drag looks locked to the spoke → mark this task skipped / N/A and stop.

If the star is in the right place but grab fires early (word leaves before tip arrives) or late (tip passes through before word moves): adjust `PRIME_LEAD_DEG` only.

- [ ] **Step 2: Tweak prime lead**

Current:

```ts
const PRIME_LEAD_DEG = 12;
```

If grab is late (tip already past **E**): increase toward `16`–`18`.  
If grab is early (word moves before tip arrives): decrease toward `8`–`10`.

Do not change `STAR_AMBIENT_DEG_S`, `STAR_HANDOFF_DEG_S`, drag fade, or ride constants unless the tip-touch still fails after this one knob.

- [ ] **Step 3: Re-run visual check**

Hard reload → tip meet → drag → `humans` → park. Confirm Final dock still OK.

- [ ] **Step 4: Commit (only if user asked and git exists)**

```bash
git add web/src/terra/TerraLanding.tsx
git commit -m "$(cat <<'EOF'
Tune star grab lead so tip contact matches the Engineers drag.

EOF
)"
```

Skip if no `.git` or user did not request a commit.

---

## Spec coverage

| Spec requirement | Task |
| --- | --- |
| Hero `--sh-star-x: -12vw` | Task 1 |
| Hero `--sh-star-y: 7vh` | Task 1 |
| Parked `--sh-star-x: -18vw` | Task 1 |
| No drawn spoke line | Tasks 1–2 (no line UI) |
| No auto-measure placement | Tasks 1–2 (CSS only) |
| No hero size change | Task 1 leaves `width: min(50.4vh, 72vw, 420px)` |
| Final dock unchanged | Task 1 does not touch dock CSS/JS |
| Mid-page path unchanged | Task 1 does not touch `useStarSectionSide` |
| Keep spoke drag / humans ride | Task 2 optional only; default leave `HeroTitle` alone |
| ±2vw/±2vh tune allowance | Task 1 Step 3 |
| Success: tip touches **E**, drag + replace, park, scroll/dock OK | Task 1 Step 3 (+ Task 2 if needed) |

## Self-review

1. **Spec coverage:** All locked decisions and success criteria map to Task 1 or optional Task 2; no gaps.
2. **Placeholders:** None — exact CSS values and file locations included.
3. **Consistency:** Parked y intentionally omitted so vertical stays at hero `7vh`; section `±26vw` left as-is per spec.
