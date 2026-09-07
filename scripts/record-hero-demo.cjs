#!/usr/bin/env node
// Render the hero one animation frame at a time. See the video folder README.
const { chromium } = require(process.env.TERRA_PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const output = path.resolve(__dirname, '../apps/web/public/videos/landing');
const scratch = mkdtempSync(path.join(tmpdir(), 'terra-hero-frames-'));
const ffmpeg = process.env.TERRA_FFMPEG || 'ffmpeg';
const FPS = 60;
// Playwright schedules animation callbacks in 16 ms steps. Capture each step,
// then play at 60 fps: a slight slowdown, with no repeated or skipped RAF ticks.
const STEP_MS = 16;
const run = (args) => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`FFmpeg exited ${result.status}`);
};

(async () => {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.TERRA_CHROMIUM ? { executablePath: process.env.TERRA_CHROMIUM } : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto(process.env.TERRA_VIDEO_URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    await page.evaluate(() => {
      // The Playwright clock controls JS, while CSS / Web Animations have their
      // own clock. Pause and seek those too, including newly mounted transitions.
      const starts = new WeakMap();
      let time = 0;
      window.advanceFilmAnimations = (delta) => {
        time += delta;
        for (const animation of document.getAnimations()) {
          if (animation.playState === 'finished') continue;
          if (!starts.has(animation)) starts.set(animation, time);
          const elapsed = time - starts.get(animation);
          const end = animation.effect.getComputedTiming().endTime;
          animation.pause();
          animation.currentTime = elapsed;
          if (Number.isFinite(end) && elapsed >= end) animation.finish();
        }
        const cursor = document.querySelector('.sh-demo-cursor');
        return {
          map: !!document.querySelector('.sh-hero-demo .sh-ws__stage.is-map'),
          preview: !!document.querySelector('.sh-hero-demo .sh-ws__preview'),
          scan: document.querySelector('.sh-hero-demo .sh-ws__status-label')?.textContent ?? null,
          chat: document.querySelectorAll('.sh-hero-demo .sh-terra-chat__msg').length,
          cursor: cursor ? getComputedStyle(cursor).transform : null,
        };
      };
      window.scrollTo(0, 1000);
    });
    const tick = async () => {
      await page.clock.runFor(STEP_MS);
      return page.evaluate((delta) => window.advanceFilmAnimations(delta), STEP_MS);
    };
    // Let the scroll land the drag, expand the window and mount the film.
    for (let frame = 0; frame < 90; frame++) await tick();
    const bounds = await page.locator('.sh-hero-demo').boundingBox();
    if (!bounds) throw new Error('Hero workspace card is missing');
    const clip = {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.floor(bounds.width / 2) * 2,
      height: Math.floor(bounds.height / 2) * 2,
    };
    // The film loops. Capturing from wherever the warm-up left off would open
    // part-way through the scan, so run — without saving frames — to the seam
    // where the map is torn down for the next pass, and start there. What
    // follows is one whole cycle: clone, scan, map, trace, preview, chat.
    let state = null;
    const seekSeam = async () => {
      let mapped = false;
      for (let step = 0; step < 4000; step++) {
        state = await tick();
        if (state.map) mapped = true;
        else if (mapped) return true;
      }
      return false;
    };
    if (!(await seekSeam())) throw new Error('Film never reached a loop seam');
    const telemetry = [];
    let mapFrame = -1;
    let previewFrame = -1;
    let posterFrame = -1;
    let mapped = false;
    for (let frame = 0; frame < 2400; frame++) {
      // Stop one frame short of repeating the opening pose, so the clip loops.
      if (state.map) mapped = true;
      else if (mapped) break;
      if (state.map && mapFrame < 0) mapFrame = frame;
      if (state.preview && previewFrame < 0) previewFrame = frame;
      const file = path.join(scratch, `frame-${String(frame).padStart(4, '0')}.png`);
      await page.screenshot({ path: file, type: 'png', clip, caret: 'initial' });
      telemetry.push({ frame, ...state });
      if (mapFrame >= 0 && frame === mapFrame + 90) posterFrame = frame;
      if (frame % 120 === 0) console.log(`Rendered ${frame} frames`);
      state = await tick();
    }
    if (posterFrame < 0 || previewFrame < 0) throw new Error('Hero did not reach map and preview');
    if (!telemetry.at(-1)?.chat) throw new Error('Film stopped before the chat beats');
    if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
    run(['-framerate', String(FPS), '-i', path.join(scratch, 'frame-%04d.png'),
      '-an', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow',
      '-crf', '18', '-movflags', '+faststart', path.join(output, 'workspace-demo.mp4')]);
    run(['-i', path.join(scratch, `frame-${String(posterFrame).padStart(4, '0')}.png`),
      '-q:v', '2', path.join(output, 'workspace-demo-poster.jpg')]);
    // README weight, not fidelity, sets these: the MP4 beside it is the good
    // copy. A frame every 4 centiseconds is exactly representable by GIF, so
    // 25 fps plays evenly where a 30 fps GIF would round its delays and drift.
    run(['-i', path.join(output, 'workspace-demo.mp4'), '-filter_complex',
      '[0:v]fps=25,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
      '-loop', '0', path.join(output, 'workspace-demo.gif')]);
    const stats = { fps: FPS, frames: telemetry.length, clip, mapFrame, previewFrame, telemetry };
    if (process.env.TERRA_VIDEO_REPORT) writeFileSync(process.env.TERRA_VIDEO_REPORT, JSON.stringify(stats));
    console.log(`Created ${(telemetry.length / FPS).toFixed(1)}s at ${FPS} fps; README animation at 50 fps`);
    if (process.env.TERRA_KEEP_FRAMES) console.log(`Frames retained: ${scratch}`);
    else rmSync(scratch, { recursive: true, force: true });
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
