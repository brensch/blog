// Bot speed for a snek build: a local server (dev mode), me + two hard bots;
// I die fast, the bots play on, and their per-move searches are read from
// the console (`compute bot=… search=…ms … sims=…`).
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8090/';
const WANT = +(process.env.N || 40);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 390, height: 760 } });
const samples = [];
p.on('console', (m) => {
  const t = m.text();
  const g = /search=(\d+)ms .*sims=(\d+)/.exec(t);
  if (t.startsWith('compute') && g) samples.push([+g[1], +g[2]]);
});
await p.goto(URL, { waitUntil: 'networkidle' });
await p.getByPlaceholder('your name').fill('bench');
await p.getByRole('button', { name: "That's me" }).click();
await p.getByRole('button', { name: /Start new game/ }).click();
await p.getByText('Players').waitFor({ timeout: 15000 });
for (let i = 0; i < 2; i++) {
  await p.getByRole('button', { name: '➕ add a bot' }).click();
  await p.getByRole('button', { name: '🐲 hard' }).click();
}
await p.locator('select').nth(1).selectOption('500');
await p.getByRole('button', { name: "I'm ready!" }).click();
await p.getByRole('button', { name: 'Start game' }).click({ force: true });
const t0 = Date.now();
while (samples.length < WANT && Date.now() - t0 < 120000) await p.waitForTimeout(250);
const wasm = await p.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.wasm')).map((r) => r.encodedBodySize || r.transferSize)[0]);
const s = samples.slice(4); // skip warm-up
const rate = s.reduce((a, [ms, n]) => a + n, 0) / s.reduce((a, [ms]) => a + ms, 0);
console.log(JSON.stringify({ samples: s.length, simsPerMs: +rate.toFixed(2), medianSims: s.map((x) => x[1]).sort((a, b) => a - b)[s.length >> 1], wasmTransfer: wasm }));
await b.close();
