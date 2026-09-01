# Isolated Antique Celestial Globe

## Goal

Place a real antique celestial globe inside the landing hero's black field while keeping Terra's existing code glyphs surrounding it.

## Source Asset

Use the CC0 museum scan “Celestial globe” by Virtual Museums of Małopolska (Sketchfab model `341fa8a777e94883841409438756f747`). The object is attributed to Johann Gabriel Doppelmayr, after 1744, from the Jagiellonian University Museum Collegium Maius.

Import only the scan's spherical globe geometry and its `4120_sphere_BaseColor` texture. Permanently discard the meridian ring, octagonal horizon, compass, axle, tablet, supports, base, and legs. The shipped local asset must contain no hidden stand geometry.

## Experience

The bare painted sphere sits centered inside the existing charcoal disc at the existing `MAP_FILL` scale, inside the glyph shell. The current code characters remain the outer visual layer and continue wrapping around the sphere. The historical constellation artwork stays fully authentic; do not redraw, generate, recolor, or add decorative celestial imagery.

The sphere rotates slowly and follows the existing globe yaw and pitch softly enough to preserve the scanned artwork. On scroll, it fades with the charcoal disc before the character shell unravels into the existing stream transition. The glyph journey itself remains unchanged.

## Implementation

Prepare one web-sized local 3D asset containing only the sphere mesh and its authentic texture. Load it locally rather than embedding Sketchfab or depending on a third-party runtime.

Render the sphere as a separate layer behind the existing glyph canvas. Reuse the current globe sizing, center, pointer orientation, intersection visibility, and reduced-motion state. Use `three` and its `GLTFLoader` directly to load the local asset; do not add React Three Fiber, a scene framework, or a component abstraction.

## Responsive and Accessibility Behavior

Use the same computed center as the glyph shell and the existing `MAP_FILL` proportion on desktop and mobile so the symbols continue to surround the smaller sphere. The object is decorative and hidden from assistive technology. With reduced motion, render the sphere at a fixed orientation and retain the existing static glyph treatment.

## Performance and Failure Boundaries

Downsize the texture only as far as browser performance requires while keeping the painted constellation figures crisp at the largest rendered size. Pause rendering outside the viewport and cap device-pixel ratio consistently with the existing globe renderer.

If the 3D asset or renderer fails, keep the current glyph globe and landing content functional; the antique sphere may disappear without blocking navigation or the Power demo.

## Verification

- Confirm visually that only the spherical artifact appears: no black meridian ring, wooden horizon, axle, compass, support, base, or legs.
- Confirm the code glyphs still surround the sphere and remain interactive.
- Confirm the existing scroll-to-screen transition still completes on desktop and mobile.
- Confirm reduced motion is static and WebGL failure leaves the page usable.
- Run the focused landing tests, lint, and production web build.

## Out of Scope

- Recreated, generated, or hand-painted celestial artwork
- The source artifact's stand or mechanical hardware
- A Sketchfab iframe, watermark, controls, or production network dependency
- Changes to the Power demo or the character-stream geometry
