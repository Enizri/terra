# Nav scroll collapse + Terra mark

**Date:** 2026-08-04  
**Status:** Approved design (Approach 1)  
**Scope:** Parker-style scroll collapse on Terra’s frosted pill nav; replace shuttle icon with gradient Terra rectangle.

## Goal

Match [heyparker.ai](https://heyparker.ai) nav scroll behavior on Terra’s existing frosted pill:

- **Scroll down** → collapse to logo + CTA (links hide)
- **Scroll up** → expand full links again
- Replace blue shuttle `icon.png` / `icon.webp` in nav (and Final glyph) with the brand gradient rectangle already used by the hero Terra pusher

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Visual language | Keep Terra frosted pill (no Parker hard border / offset shadow) |
| Scroll UX | Collapse links on scroll down; expand on scroll up (not hide entire nav) |
| Animation stack | Motion (already in `TerraLanding`) + CSS |
| Mark | CSS gradient rectangle (same wash as `.sh-hero-push__body`), not shuttle image |
| Wordmark | Keep “Terra” text beside the mark in the nav |
| Reduced motion | Instant expand/collapse; no spring |

## Non-goals

- Restyling the pill to Parker’s black border / hard shadow
- Hiding the entire nav off-screen on scroll down
- Changing link labels, CTA copy, or section anchors
- Replacing icons elsewhere (trust logos, GitHub mark, etc.)
- Building a separate nav design system beyond this landing page

## Current behavior (baseline)

`TerraLanding` in `web/src/terra/TerraLanding.tsx`:

1. Sticky `.sh-nav` with `.sh-nav__pill` (frosted white pill)
2. Logo: `<Picture base={${IMG}/icon} />` + “Terra” (shuttle asset)
3. Links: “How it works”, “Case study”
4. CTA: “Get started”
5. No scroll-direction collapse
6. Final section glyph also uses `${IMG}/icon`

## Target behavior

1. On load, nav is expanded (all links visible). Optional: soft enter from above is nice-to-have, not required.
2. After user scrolls down past a small threshold (~24–48px from top, plus direction debounce so jitter doesn’t flicker), nav enters **collapsed** state:
   - Links fade + layout-collapse (width/gap → 0, `overflow: hidden`, or `AnimatePresence` + layout spring)
   - Logo mark + “Terra” + CTA remain
   - Pill width springs tighter around remaining items
3. On scroll **up**, return to **expanded** (links visible). At `scrollY ≈ 0`, always expanded.
4. Spring feel target (Parker-adjacent): `{ type: "spring", stiffness: 500, damping: 60, mass: 1 }`
5. `prefers-reduced-motion`: snap between states with no spring / opacity tween

## Architecture

### Units

1. **`useNavCollapse` (or inline in `TerraLanding`)** — Tracks `scrollY` / last Y; emits `collapsed: boolean`. Ignores tiny deltas; always expands near top.
2. **Nav markup** — Existing pill structure; wrap link group so it can animate open/closed without remounting the CTA.
3. **`TerraMark`** — Small rounded rectangle with the shared brand gradient; used in nav logo and Final glyph instead of `<Picture base={…/icon} />`.
4. **CSS** — `.sh-nav` / `.sh-nav__pill` stay; add collapsed helpers (link group overflow, mark size). Extract shared gradient tokens/classes from `.sh-hero-push__body` so mark + hero don’t drift.

### Data flow

```
scroll events / useScroll
  → direction + threshold → collapsed boolean
  → Motion layout/opacity on link group
  → pill width springs via layout
```

### Mark styling

Reuse the hero pusher wash:

```
radial orange @ 22% 28%,
radial lavender @ 78% 72%,
radial cream @ 58% 38%,
linear 160deg #e8400d → #d0b2ff → #ac7eff
```

Nav mark size: ~28×28px (match current logo image box), modest border-radius (~6–8px). Decorative only; “Terra” text remains the accessible name.

### Files likely touched

- `web/src/terra/TerraLanding.tsx` — scroll state, nav structure, `TerraMark`, Final glyph
- `web/src/terra/terra.css` — mark styles, collapsed link group, shared gradient utility

## Error / edge handling

- Rapid direction changes: debounce with small pixel delta (e.g. ≥8–12px) before flipping state
- Sticky + hero sticky pin: nav collapse must not break hero stick framing (`--hero-stick-top` / sticky math)
- Mobile: same collapse behavior; no separate hamburger work in this scope

## Test plan

- [ ] At top: full pill with links
- [ ] Scroll down: links collapse; logo + CTA remain; spring feels smooth
- [ ] Scroll up: links expand again
- [ ] Near top always expanded
- [ ] Reduced motion: instant state change
- [ ] No shuttle icon in nav or Final glyph; gradient rectangle present
- [ ] Hero sticky framing still correct while collapsing
