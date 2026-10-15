// schniffer: build a Yosemite Valley schniffgroup on the live map
// (schniff.brensch.com), copy the command, then the Discord side.
//
// The map half is the real site, driven live. Discord can't be filmed without
// logging in, so the second half is schniffer/discord.html: a Discord-styled
// DM rebuilt from the bot's own reply/alert templates (internal/bot,
// internal/manager/notifications.go) and a real Upper Pines alert from the
// bot's history (sites 178/009/088, 12–14 Jun 2026). Nothing is sent to
// Discord or to any reservation site.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRecording, tap, typeSlowly, sleep } from './lib/record.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewport = { width: 800, height: 640 };

const rec = await startRecording({
  name: 'schniffer',
  viewport,
  context: { permissions: ['clipboard-read', 'clipboard-write'] },
});
const { page } = rec;

// --- the map ---------------------------------------------------------------

async function openMap() {
  await page.goto('https://schniff.brensch.com/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.getElementById('refine').textContent.includes('Loading'));
  await page.waitForSelector('#intro.open');
}

// The whole map flow. Run once unfilmed so every tile on the route is cached
// (otherwise the zooms flash grey), then again for real.
async function mapFlow() {
  await sleep(2200);
  await tap(page, page.locator('#intro-ok'));
  await sleep(1300);

  // Search for Upper Pines and jump to it.
  await typeSlowly(page.locator('#search'), 'upper pines', 85);
  await sleep(900);
  await tap(page, page.locator('#results li').first());
  await page.waitForSelector('#spot:not([hidden])');
  await sleep(1800);
  await tap(page, page.locator('#spot-toggle'));
  await sleep(1200);

  // Pull back to the whole valley so its neighbours are in view.
  await page.evaluate(() => map.flyTo([37.7395, -119.58], 14, { duration: 1.6 }));
  await sleep(2600);

  // "Add all (4)": every campground in view, ticked. Untick Camp 4.
  await tap(page, page.locator('#refine'));
  await page.waitForSelector('#refine-panel.open');
  await sleep(1200);
  await tap(page, page.locator('#refine-list label', { hasText: 'Camp 4' }));
  await sleep(1000);
  await tap(page, page.locator('#refine-save'));
  await page.waitForSelector('#done.open');
  await sleep(1300);

  // Name it, copy the command.
  await typeSlowly(page.locator('#group-name'), 'Yosemite Valley', 80);
  await page.locator('#group-name').press('Enter');
  await sleep(900);
  await tap(page, page.locator('#done-copy'));
  await sleep(2200);
}

await openMap();
await mapFlow();
await page.waitForLoadState('networkidle');
await page.evaluate(() => localStorage.clear());
await openMap();
await sleep(1500); // tiles settle under the intro sheet
await rec.begin();
await mapFlow();
const command = await page.locator('#done-command').textContent();
rec.mark('discord');

// --- Discord ---------------------------------------------------------------

// Fade the map out to Discord's background; discord.html fades itself in.
await page.evaluate(() => {
  const v = document.createElement('div');
  v.style.cssText = 'position:fixed;inset:0;background:#313338;opacity:0;transition:opacity .45s;z-index:99999';
  document.body.appendChild(v);
  requestAnimationFrame(() => requestAnimationFrame(() => (v.style.opacity = '1')));
});
await sleep(550);
await page.goto('file://' + path.join(HERE, 'schniffer', 'discord.html'));
await page.evaluate(() => document.fonts.ready);
await sleep(700);

const box = page.locator('#composer');
await tap(page, box, { pause: 200 });
await page.evaluate((c) => navigator.clipboard.writeText(c), command);
await page.keyboard.press('Control+V');
await sleep(900);
await page.keyboard.press('Enter');
await sleep(2400);

await typeSlowly(box, '/schniff add-bulk group:Yosemite Valley checkin:2026-06-12 checkout:2026-06-14', 32);
await sleep(600);
await page.keyboard.press('Enter');
await sleep(2600);

// A week later: the alert, then the hold.
await page.evaluate(() => window.step('alert'));
await sleep(4200);
await page.evaluate(() => window.step('hold'));
await sleep(3800);

await rec.stop();
