# Landing hero card scale

## Goal

Make the landing hero card large and readable before the GitHub card finishes its drag, then expand it further after the drop. Match the intended large-screen presence without applying global CSS zoom or changing the page width.

## Approved behavior

- On wide screens, the pre-drop product frame grows from 720 x 412 px to 1280 x 732 px.
- After the GitHub card is fully dropped, the workspace expands up to 2400 x 1350 px.
- Both states remain capped by the available viewport width so narrower windows do not clip horizontally.
- Existing narrow-screen layout and breakpoints remain unchanged.
- The current drag, drop, sticky-scroll, and workspace-demo behavior remains unchanged.

## Implementation

- Reuse the landing page's existing `--sh-hero-window` sizing seam for the pre-drop width.
- Add only the minimum wide-screen overrides needed for the matching pre-drop height and inner frame.
- Reuse the existing `[data-dropped="1"]` and `.is-expanded` states for the larger post-drop width and height.
- Keep all rules scoped to the landing hero; do not scale the root, body, navigation, Power section, or workspace route.

## Verification

- At a 2728 x 1745 viewport, assert that the pre-drop screen is 1280 x 732 px and fully inside the hero card.
- Complete the drag and assert that the expanded workspace is no wider than 2400 px, targets 1350 px tall when space allows, and remains fully inside the hero card.
- Check one narrower desktop viewport to confirm the viewport cap prevents horizontal clipping.
- Run the existing web build.

## Out of scope

- Global browser-zoom emulation.
- Page-width compensation or root transforms.
- Typography, navigation, Power-section spacing, or other landing-section changes.
- Workspace-route sizing.
