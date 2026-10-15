// ppp: plan San Francisco → Los Angeles, then filter the food at every
// supercharger stop down to sushi, browse the stops, and open one on the map.
// Landscape 16:10, roughly the shape of the Tesla screen it is built for.
import { startRecording, tap, typeSlowly, sleep } from './lib/record.mjs';

const rec = await startRecording({
  name: 'ppp',
  viewport: { width: 840, height: 525 },
  geolocation: { latitude: 37.7749, longitude: -122.4194 },
  context: { timezoneId: 'America/Los_Angeles', locale: 'en-US' },
});
const { page } = rec;

// Leaflet fades tiles in as they arrive; wait until the map is fully drawn.
async function tilesLoaded() {
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('.leaflet-tile').length > 0 &&
        !document.querySelector('.leaflet-tile:not(.leaflet-tile-loaded)'),
      null,
      { timeout: 20000, polling: 100 },
    )
    .catch(() => {});
  await sleep(400); // the fade-in
}

await page.goto('https://ppp.brensch.com/', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await sleep(500);
await rec.begin();
await sleep(1200);

// Where from, where to — through the autocomplete.
await typeSlowly(page.getByPlaceholder('Current Location'), 'San Francisco');
await tap(page, page.getByText('San Francisco, CA, USA', { exact: true }));
await sleep(300);
await typeSlowly(page.getByPlaceholder('Preferred Place of Passage'), 'Los Angeles');
await tap(page, page.getByText('Los Angeles, CA, USA', { exact: true }));
await sleep(700);
rec.mark('plan');
await tap(page, page.getByText('Plan Princess Portage'));

// The route: chargers clustered along the drive.
await page.getByText('Filter').waitFor({ timeout: 120000 });
rec.mark('overview');
await tilesLoaded();
await sleep(2800);

// Nobody wants a burger. Sushi, please.
await tap(page, page.getByText('Filter'));
await sleep(700);
await typeSlowly(page.getByPlaceholder('Cuisines'), 'sus', 110);
await sleep(600);
await tap(page, page.getByText(/Sushi Restaurant/).first());
await sleep(900);
await tap(page, page.getByRole('button', { name: 'Perfect' }));
await tilesLoaded();
await sleep(1800);

// Every stop, its arrival time, and the sushi a short walk away.
await tap(page, page.getByRole('button', { name: /Results/ }));
rec.mark('results');
await sleep(1800);
// Glide down past the Bay Area to a stop that is properly on the road.
const target = await page.evaluate(() => {
  const dist = {};
  for (const tr of document.querySelectorAll('tr[data-charger-id]')) {
    const m = tr.querySelector('td')?.innerText.match(/([\d.]+) mi/);
    if (m && !(tr.dataset.chargerId in dist)) dist[tr.dataset.chargerId] = parseFloat(m[1]);
  }
  const links = [...document.querySelectorAll('.restaurant-link')];
  const i = links.findIndex((a) => (dist[a.closest('tr').dataset.chargerId] ?? 0) >= 50);
  return i < 0 ? 0 : i;
});
await page.evaluate(async (i) => {
  const box = document.querySelector('.h-full.overflow-y-auto');
  const row = document.querySelectorAll('.restaurant-link')[i].closest('tr');
  const first = document.querySelector(`tr[data-charger-id="${row.dataset.chargerId}"]`);
  const from = box.scrollTop;
  const to = from + first.getBoundingClientRect().top - box.getBoundingClientRect().top - 40;
  const ms = 2200;
  const t0 = performance.now();
  await new Promise((done) => {
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      box.scrollTop = from + (to - from) * e;
      k < 1 ? requestAnimationFrame(step) : done();
    };
    requestAnimationFrame(step);
  });
}, target);
await sleep(1800);

// Pick it and see where it is, then the charger it is next to.
// Cut over the zoomed map's tiles loading in.
await tap(page, page.locator('.restaurant-link').nth(target));
rec.pause();
await tilesLoaded();
await sleep(300);
await rec.resume();
rec.mark('restaurant');
await sleep(2600);
const vw = page.viewportSize();
const chargers = page.locator('.charger-icon');
let best = null;
for (let i = 0; i < (await chargers.count()); i++) {
  const b = await chargers.nth(i).boundingBox();
  if (!b) continue;
  const d = Math.hypot(b.x - vw.width / 2, b.y - vw.height / 2);
  if (!best || d < best.d) best = { i, d };
}
if (best) {
  await page.locator('.leaflet-popup-close-button').click().catch(() => {});
  await sleep(500);
  // Nudge the map down so the charger's popup has room above it.
  const cb = await chargers.nth(best.i).boundingBox();
  const want = vw.height * 0.78;
  if (cb && cb.y < want) {
    await page.mouse.move(vw.width * 0.6, vw.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(vw.width * 0.6, vw.height * 0.35 + (want - cb.y), { steps: 25 });
    await page.mouse.up();
    await tilesLoaded();
  }
  await tap(page, chargers.nth(best.i), { force: true });
  rec.mark('charger');
  await sleep(4800);
}
await rec.stop();
