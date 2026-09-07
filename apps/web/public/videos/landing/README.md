# Terra hero walkthrough

`workspace-demo.mp4` is a silent, 60 fps H.264 recording of just the hero's inner
workspace card, covering one complete pass of the film: the repository clone and
scan, the architecture map landing, the cursor tracing components and opening
Web App, the Memos live preview, and the closing chat exchange.
`workspace-demo.gif` is a lighter 25 fps, 800 px preview, and the copy embedded
in the root README. A matching JPEG poster is also included.
The surrounding landing page, external captions, and closing title are excluded.

The recorder starts at a loop seam — the frame where the film tears the map down
to rescan — so the clip opens on `Cloning github.com/usememos/memos` and ends one
frame before that same pose returns. It therefore loops without a visible cut.

This is a **scripted product walkthrough**, not a live analysis or a performance
benchmark. The chat beats at the end, including the PR it offers to open, are
illustrative UI copy. No provider keys, model calls, or third-party repository
execution are involved in creating it.

To reproduce, start the web app with `make run-web`. Install Playwright and its
Chromium browser in a temporary directory, and have an FFmpeg binary with
`libx264` support available:

```sh
npm install --prefix /tmp/terra-video-tools playwright
/tmp/terra-video-tools/node_modules/.bin/playwright install chromium
TERRA_PLAYWRIGHT_MODULE=/tmp/terra-video-tools/node_modules/playwright \
  node scripts/record-hero-demo.cjs
```

Optional environment overrides: `TERRA_VIDEO_URL` (default
`http://127.0.0.1:5173/`), `TERRA_CHROMIUM` (browser executable), and `TERRA_FFMPEG`
(default `ffmpeg`). The recorder measures the expanded card, then advances the
JavaScript and CSS animation clocks together and captures every frame as a PNG.
Those frames become the MP4, GIF, and poster. It does not upscale the frame rate
of a real-time browser screen recording. Each 16 ms animation tick plays as one
60 fps video frame, slowing the sequence by about 4% for consistent motion.
The GIF is sized for README weight rather than fidelity, at exact 40 ms frame
delays so its timing stays even.

Set `TERRA_VIDEO_REPORT` to a JSON output path to save frame counts, scene
transitions, scan labels, chat length, and cursor positions for verification. `TERRA_KEEP_FRAMES=1` retains
the temporary PNG sequence for inspection.
