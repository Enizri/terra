# Full-bleed landing hero card

## Goal

Give the Terra landing a full painted hero card — the painting runs nearly edge to edge and taller than the viewport — while preserving Terra's GitHub drag and expanded workspace. Keep the painting directly below the navigation instead of vertically centering it on tall screens.

## Approved behavior

- At desktop widths, the outer painting uses `min(calc(110svh - 108px), 1450px)`. The painting is deliberately taller than the viewport so it reads big; the overflow is reachable because the hero section unpins around y=700.
- At the top of the page, the painting starts about 100 px from the viewport top instead of moving down as the viewport gets taller.
- The pre-drop product frame keeps its existing size and width behavior.
- After the GitHub card is fully dropped, the outer painting grows naturally with Terra's existing expanded workspace content.
- Existing narrow-screen layout and breakpoints remain unchanged.
- The current drag, drop, sticky-scroll, and workspace-demo behavior remains unchanged.

## Implementation

- Set the desktop outer-card minimum height to `min(calc(110svh - 108px), 1450px)`. Never tie the `svh` term to `--sh-read`: the viewport does not shrink with the reading scale, so scaling it double-counts.
- Remove the viewport-height centering calculation from the sticky hero measurement and reuse the existing minimum landing gap.
- Keep all rules scoped to the outer landing hero; do not scale the root, body, product frame, navigation, Power section, or workspace route.

## Verification

- At a 2728 x 1745 viewport, assert that the painting begins about 100 px from the top rather than the current 323 px.
- Assert that the desktop outer-card minimum height resolves to `min(calc(110svh - 108px), 1450px)`.
- Complete the drag and assert that the outer painting grows taller without changing page width or clipping horizontally.
- Check one narrower viewport to confirm the existing responsive card rule remains intact.
- Run the existing web build.

## Out of scope

- Global browser-zoom emulation.
- Page-width compensation or root transforms.
- Inner product-frame sizing, typography, navigation, Power-section spacing, or other landing-section changes.
- Workspace-route sizing.
