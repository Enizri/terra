# Globe-to-Terra Screen Transition

## Goal

Replace the current Power-section heading, paragraph, and handwritten note with a scroll-controlled visual journey from the existing hero globe into the existing Terra demo screen.

## Experience

The globe visually leaves the right side of the hero as the visitor scrolls. It rotates slowly while its circular glyph rings stretch into five to seven flowing character lines. Those lines converge on the Terra demo screen, pass behind its bezel, and disappear. The capability list and interactive demo remain unchanged.

The transition is directly scrubbed by scroll position rather than playing on a timer:

1. The globe travels away from its hero position.
2. Its spherical silhouette loosens into character streams.
3. The streams narrow toward the demo screen.
4. The screen bezel clips the streams at the destination.

The motion should feel calm and continuous. It must not pause, bounce, or keep animating after the streams enter the screen.

## Implementation

Add one sticky transition scene between `HeroChars` and `PowerSection`. Reuse the existing WebGL glyph renderer, character atlas, and globe geometry helpers. Extend the pure layout calculation with scroll progress so the globe-to-stream geometry remains testable without a browser or GPU.

Remove the Power heading and lede from `PowerSection`, remove `TryItNote`, and delete their now-unused styles and copy only when no other caller uses them. Keep the capability rail, tabs, demo screen, and their behavior intact.

Use the existing motion dependency and browser scroll APIs. Add no package.

## Responsive and Accessibility Behavior

On desktop, the globe follows a curved path from the hero side toward the demo screen. On smaller screens, use a shorter centered vertical path so the streams stay inside the viewport.

When reduced motion is requested, omit the journey and reveal the existing Power content normally. The transition is decorative and hidden from assistive technology. Existing keyboard and tab behavior remains unchanged.

## Performance and Failure Boundaries

Render through one visible transition canvas and update it only while its section intersects the viewport. Reuse one allocated glyph buffer and avoid React state updates per animation frame. If WebGL is unavailable, the page must still expose the capability list and demo screen without the decorative transition.

## Verification

Add one focused test for the pure scroll-progress geometry: sphere at the start, stretched streams in the middle, and converged endpoint at completion. Run the relevant landing tests, lint, and the production web build.

## Out of Scope

- Particles, glow effects, sound, or post-entry animation
- Changes to the capability list or demo interactions
- A new animation library or generic scroll-animation abstraction
- Reworking the hero globe's existing pointer interaction
