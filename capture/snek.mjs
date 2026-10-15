// snek: introduce yourself, start a game, add the wasm bots, then play a
// real game against them on the live site (snek.brensch.com).
//
// The human snek is steered by a small greedy pilot that reads the board
// straight out of the SVG (food emoji, every snek's path) and presses arrow
// keys — so the d-pad lights up in our colour exactly as it does for a
// person. The bots are the real thing: MCTS compiled to wasm, thinking in a
// Web Worker in this very browser.
//
//   node snek.mjs            # → out/snek/{frames,manifest.json}
import { startRecording, tap, typeSlowly, sleep } from './lib/record.mjs';

const URL = 'https://snek.brensch.com/';
const NAME = 'brendan';
const COLOUR_INDEX = 14; // hot pink — clear of the bots' blues and purples
const BOTS = ['🐲 hard'];
const SPEED = '500'; // Fast (0.5s)
const BOARD = '13'; // Medium
const MAX_GAME_MS = 120_000;
// First of these the shuffled hand offers wins; otherwise whatever is there.
const EMOJI_WISHES = ['🦖', '🐉', '🦞', '🦔', '🦒', '🐊', '🦈', '🦑', '🐙', '🦀', '🦄', '🐸', '🦊', '🐯', '🐼', '🦦', '🦥', '🦫', '🦣', '🦚', '🌮', '🍕', '🚀', '🔥'];

const rec = await startRecording({
  name: 'snek',
  viewport: { width: 390, height: 760 },
  isMobile: false,
});
const { page } = rec;
page.on('pageerror', (e) => console.log('pageerror', e.message));

// SNEK_DIST=<trunk dist dir>: film a frontend build that isn't deployed yet,
// served in place of the live one; games still run on the live server.
if (process.env.SNEK_DIST) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  const dist = process.env.SNEK_DIST;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.woff2': 'font/woff2' };
  await page.route(URL + '**', (route) => {
    const u = new globalThis.URL(route.request().url());
    if (u.pathname.startsWith('/api/')) return route.continue();
    let f = path.join(dist, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
    return route.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
  });
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.getByPlaceholder('your name').waitFor();
// Off camera: shuffle until the hand holds the emoji we want (the hand is a
// random 24 of ~200).
const emojis = page.locator('.emoji-grid .pick');
for (let i = 0; i < 40; i++) {
  const hand = await emojis.allTextContents();
  if (EMOJI_WISHES.slice(0, 2).some((e) => hand.includes(e))) break;
  await page.getByRole('button', { name: '🎲 shuffle' }).click();
  await sleep(50);
}
await sleep(500);
await rec.begin();
await sleep(700);

// --- introduce yourself -------------------------------------------------
await typeSlowly(page.getByPlaceholder('your name'), NAME, 90);
await sleep(300);
await tap(page, emojis.nth(5));
await sleep(400);
const hand = await emojis.allTextContents();
const wish = EMOJI_WISHES.find((e) => hand.includes(e));
await tap(page, wish ? emojis.nth(hand.indexOf(wish)) : emojis.nth(10));
await sleep(300);
const colour = page.locator('.swatches .pick').nth(COLOUR_INDEX);
await tap(page, colour);
await sleep(500);
const myColour = await colour.evaluate((el) => getComputedStyle(el).backgroundColor);
await tap(page, page.getByRole('button', { name: "That's me" }));

// --- start a game, add bots, ready up -----------------------------------
const startBtn = page.getByRole('button', { name: /Start new game/ });
await startBtn.waitFor();
await sleep(900);
await tap(page, startBtn);
await page.getByText('Players').waitFor({ timeout: 15_000 });
await sleep(900);

for (const bot of BOTS) {
  await tap(page, page.getByRole('button', { name: '➕ add a bot' }));
  await sleep(500);
  await tap(page, page.getByRole('button', { name: bot }));
  await sleep(700);
}
// Small board, fast ticks: the clip is mostly snek.
await page.locator('select').nth(0).selectOption(BOARD);
await sleep(500);
await page.locator('select').nth(1).selectOption(SPEED);
await sleep(600);

await tap(page, page.getByRole('button', { name: "I'm ready!" }));
const go = page.getByRole('button', { name: 'Start game' });
await go.waitFor({ timeout: 10_000 });
await sleep(700);
rec.mark('lobby-done');
await tap(page, go, { force: true });

// --- play ---------------------------------------------------------------
await page.locator('.board-wrap svg').waitFor({ timeout: 15_000 });
rec.mark('game');
const t0 = Date.now();
let lastSig = '';
let moves = 0;
while (Date.now() - t0 < MAX_GAME_MS) {
  const s = await page.evaluate(readBoard, myColour).catch(() => null);
  if (!s) break;
  if (s.over) break;
  if (s.sig !== lastSig && s.me) {
    lastSig = s.sig;
    const dir = choose(s);
    if (dir) {
      await page.keyboard.press(dir);
      moves++;
    }
  }
  await sleep(40);
}
rec.mark('over');
console.log(`played ${moves} moves in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// The results under a rain of the winner's emoji.
await sleep(4500);
await rec.stop();

// --- board reading (runs in the page) -----------------------------------
function readBoard(myColour) {
  const svg = document.querySelector('.board-wrap svg');
  if (document.querySelector('.results')) return { over: true };
  if (!svg) return null;
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  const W = vw + 2;
  const H = vh + 2;
  // Normalise colours to whatever the browser computes.
  const norm = (c) => {
    const d = document.createElement('div');
    d.style.color = c;
    document.body.appendChild(d);
    const v = getComputedStyle(d).color;
    d.remove();
    return v;
  };
  const mine = norm(myColour);
  const food = [];
  const blocked = [];
  const heads = [];
  let me = null;
  const cell = (x, y) => [Math.floor(x), Math.floor(y)];
  const foodGlyph = document.querySelector('.footnote')?.textContent; // lobby only
  for (const t of svg.querySelectorAll('text')) {
    const fs = t.getAttribute('font-size');
    if (fs !== '0.8') continue;
    const x = +t.getAttribute('x');
    const y = +t.getAttribute('y');
    const prev = t.previousElementSibling;
    // A head emoji follows its head <rect>; food text follows other text or the field.
    const isHead =
      prev && prev.tagName === 'rect' && prev.getAttribute('width') === '1' &&
      !['#dcedc8', '#cfe6b8', '#d3d3d3'].includes(prev.getAttribute('fill')) &&
      Math.abs(+prev.getAttribute('x') + 0.5 - x) < 0.01 && Math.abs(+prev.getAttribute('y') + 0.5 - y) < 0.01;
    if (!isHead) {
      if (prev && prev.getAttribute('fill') === '#d3d3d3') blocked.push(cell(x, y)); // clash trail
      else food.push(cell(x, y));
    }
  }
  for (const r of svg.querySelectorAll('rect')) {
    const fill = r.getAttribute('fill');
    if (fill === '#dcedc8' || fill === '#cfe6b8' || fill === '#d3d3d3') continue;
    const x = +r.getAttribute('x');
    const y = +r.getAttribute('y');
    blocked.push([x, y]);
    const len = [...svg.querySelectorAll('polyline')].find((p) => p.getAttribute('stroke') === fill)
      ?.getAttribute('points').split(' ').length ?? 1;
    const isMe = norm(fill) === mine;
    if (isMe) me = { x, y, len };
    else heads.push({ x, y, len });
  }
  for (const p of svg.querySelectorAll('polyline')) {
    const pts = p.getAttribute('points').split(' ').map((s) => s.split(',').map(Number));
    // Leave the very tail free (it moves) unless it is stacked.
    for (const [x, y] of pts.slice(0, -1)) blocked.push(cell(x, y));
  }
  const sig = JSON.stringify([me, heads, food.length, blocked.length]);
  return { W, H, food, blocked, heads, me, sig, over: false };
}

function choose({ W, H, food, blocked, heads, me }) {
  const key = (x, y) => y * W + x;
  const wall = (x, y) => x < 1 || y < 1 || x >= W - 1 || y >= H - 1;
  const bad = new Set(blocked.map(([x, y]) => key(x, y)));
  const DIRS = [
    ['ArrowUp', 0, -1],
    ['ArrowDown', 0, 1],
    ['ArrowLeft', -1, 0],
    ['ArrowRight', 1, 0],
  ];
  // Cells a bigger-or-equal head could step into next turn: avoid.
  const danger = new Set();
  for (const h of heads) {
    if (h.len < me.len) continue;
    for (const [, dx, dy] of DIRS) danger.add(key(h.x + dx, h.y + dy));
  }
  const free = (x, y) => !wall(x, y) && !bad.has(key(x, y));
  const flood = (sx, sy) => {
    const seen = new Set([key(sx, sy)]);
    const q = [[sx, sy]];
    while (q.length && seen.size < 200) {
      const [x, y] = q.shift();
      for (const [, dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (free(nx, ny) && !seen.has(key(nx, ny))) {
          seen.add(key(nx, ny));
          q.push([nx, ny]);
        }
      }
    }
    return seen.size;
  };
  // BFS distance to nearest food from a start cell.
  const foodSet = new Set(food.map(([x, y]) => key(x, y)));
  const distToFood = (sx, sy) => {
    const seen = new Set([key(sx, sy)]);
    let frontier = [[sx, sy]];
    for (let d = 0; frontier.length && d < 60; d++) {
      const next = [];
      for (const [x, y] of frontier) {
        if (foodSet.has(key(x, y))) return d;
        for (const [, dx, dy] of DIRS) {
          const nx = x + dx;
          const ny = y + dy;
          if (free(nx, ny) && !seen.has(key(nx, ny))) {
            seen.add(key(nx, ny));
            next.push([nx, ny]);
          }
        }
      }
      frontier = next;
    }
    return 99;
  };
  let best = null;
  for (const [name, dx, dy] of DIRS) {
    const nx = me.x + dx;
    const ny = me.y + dy;
    if (!free(nx, ny)) continue;
    const space = flood(nx, ny);
    const df = distToFood(nx, ny);
    let score = -df * 3 + Math.min(space, 40);
    if (space < me.len + 4) score -= 1000 - space * 5;
    if (danger.has(key(nx, ny))) score -= 500;
    // Walls are where sneks go to die: keep a little off them.
    if (nx === 1 || ny === 1 || nx === W - 2 || ny === H - 2) score -= 2;
    if (!best || score > best.score) best = { name, score };
  }
  return best?.name;
}
