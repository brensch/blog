// Shared browser recorder for the project captures.
//
// Records only the page (no browser chrome) via the Chrome DevTools screencast:
// every repaint arrives as a JPEG with a timestamp, which we write to
// <outDir>/frames/NNNNN.jpg plus a manifest.json of timestamps. encode.py turns
// that into an animated WebP with the real per-frame timings.
//
//   const rec = await startRecording({ name: 'snek', viewport: { width: 420, height: 760 } });
//   const { page } = rec;
//   await page.goto(...); await tap(page, page.getByText('Play'));
//   await rec.stop();
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_ROOT = path.resolve(HERE, '..', 'out');

export async function startRecording({
  name,
  viewport,
  deviceScaleFactor = 2,
  colorScheme = 'light',
  isMobile = false,
  hasTouch = false,
  geolocation,
  launch = {},
  context: contextOpts = {},
}) {
  const outDir = path.join(OUT_ROOT, name);
  const frameDir = path.join(outDir, 'frames');
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });

  // Emulating deviceScaleFactor alone still screencasts at 1x; forcing it on
  // the browser too is what makes the frames come through at full density.
  const browser = await chromium.launch({
    channel: 'chrome',
    ...launch,
    args: [`--force-device-scale-factor=${deviceScaleFactor}`, ...(launch.args ?? [])],
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    colorScheme,
    isMobile,
    hasTouch,
    ...(geolocation ? { geolocation, permissions: ['geolocation'] } : {}),
    ...contextOpts,
  });
  const page = await context.newPage();
  await page.addInitScript(TAP_OVERLAY);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  let recording = false;
  let marks = [];
  // Seconds spent paused, taken off every later timestamp so a pause is a cut.
  let offset = 0;
  let pausedAt = null;
  const now = () => Date.now() / 1000 - offset;
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!recording) return;
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(frameDir, file), Buffer.from(data, 'base64'));
    // Keep time monotonic across a resume (a frame drawn mid-pause can land late).
    frames.push({ file, t: Math.max(frames.at(-1)?.t ?? 0, metadata.timestamp - offset) });
  });

  const rec = {
    page,
    context,
    browser,
    outDir,
    /** Start keeping frames (call after any setup you don't want filmed). */
    async begin() {
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 95,
        maxWidth: viewport.width * deviceScaleFactor,
        maxHeight: viewport.height * deviceScaleFactor,
        everyNthFrame: 1,
      });
      recording = true;
    },
    /** Drop everything filmed so far (e.g. a loading flash before the good part). */
    reset() {
      for (const f of frames) fs.rmSync(path.join(frameDir, f.file), { force: true });
      frames.length = 0;
      marks = [];
    },
    /** Name a moment, so encode.py can cut segments out (see --cut). */
    mark(label) {
      marks.push({ label, t: now() });
    },
    /** Stop filming (e.g. while a map loads); resume() continues as a jump cut. */
    pause() {
      if (pausedAt !== null) return;
      recording = false;
      pausedAt = Date.now() / 1000;
    },
    async resume() {
      if (pausedAt === null) return;
      offset += Date.now() / 1000 - pausedAt;
      pausedAt = null;
      recording = true;
      // The screencast only sends repaints; nudge one so the cut lands on what
      // is on screen now, not the last frame before the pause.
      await page
        .evaluate(() => {
          let d = document.getElementById('__rec_nudge');
          if (!d) {
            d = document.createElement('div');
            d.id = '__rec_nudge';
            d.style.cssText =
              'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:2147483647';
            document.documentElement.appendChild(d);
          }
          d.style.background = d.style.background === 'rgba(0, 0, 0, 0.01)' ? 'rgba(0, 0, 0, 0.02)' : 'rgba(0, 0, 0, 0.01)';
        })
        .catch(() => {});
    },
    async stop() {
      // Hold the last frame a beat: the screencast only sends repaints.
      await this.resume();
      frames.push({ file: frames.at(-1)?.file, t: now() });
      recording = false;
      await cdp.send('Page.stopScreencast').catch(() => {});
      fs.writeFileSync(
        path.join(outDir, 'manifest.json'),
        JSON.stringify({ viewport, deviceScaleFactor, frames, marks }, null, 1),
      );
      await browser.close();
      console.log(`${name}: ${frames.length} frames → ${outDir}`);
    },
  };
  return rec;
}

/** Click with a visible touch ripple so viewers can follow what was pressed. */
export async function tap(page, locator, { pause = 350, ...clickOpts } = {}) {
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(([x, y]) => window.__tapAt?.(x, y), [x, y]);
    await page.waitForTimeout(pause);
  }
  await locator.click(clickOpts);
}

/** Ripple at a raw point (for canvas games, maps, etc.). */
export async function tapAt(page, x, y, { pause = 250, click = true } = {}) {
  await page.evaluate(([x, y]) => window.__tapAt?.(x, y), [x, y]);
  await page.waitForTimeout(pause);
  if (click) await page.mouse.click(x, y);
}

/** Type like a person. */
export async function typeSlowly(locator, text, delay = 70) {
  await locator.click();
  await locator.pressSequentially(text, { delay });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A soft circle that grows and fades where we tap. Injected into every page.
const TAP_OVERLAY = `
window.__tapAt = (x, y) => {
  const d = document.createElement('div');
  d.style.cssText = [
    'position:fixed', 'left:' + (x - 22) + 'px', 'top:' + (y - 22) + 'px',
    'width:44px', 'height:44px', 'border-radius:50%',
    'background:rgba(255,255,255,.55)', 'border:2px solid rgba(0,0,0,.35)',
    'box-shadow:0 0 0 1px rgba(255,255,255,.6)',
    'pointer-events:none', 'z-index:2147483647',
    'transform:scale(.4)', 'opacity:1',
    'transition:transform .45s ease-out, opacity .6s ease-out .15s',
  ].join(';');
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    d.style.transform = 'scale(1)';
    d.style.opacity = '0';
  }));
  setTimeout(() => d.remove(), 900);
};
`;
