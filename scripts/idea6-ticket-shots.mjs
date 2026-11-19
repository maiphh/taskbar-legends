/* global process, window, document */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = '.grok-run/shots';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

async function prep(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    window.__game.pause();
    await window.__game.whenReady();
    window.__game.setSeed(1);
  });
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await prep(page);

const before = await page.evaluate(() => {
  window.__game.pause();
  const state = window.__game.getState();
  // Settle migration on a fresh account, then park just before open hour 6.
  window.__game.step(1);
  const s = window.__game.getState();
  const tps = 20;
  const hour6 = 6 * 3600 * tps;
  s.tick = hour6 - 1;
  s.ticketsAwardedThroughHour = 0;
  // Long encounter rest so the milestone tick is the only economy change.
  s.phase = { kind: 'rest', remainingTicks: 10_000, next: 'encounter' };
  delete s.farmClock;
  delete s.encounterFarmContext;
  window.__game.load(s);
  window.__game.pause();
  const loaded = window.__game.getState();
  return { tickets: loaded.tickets, through: loaded.ticketsAwardedThroughHour, tick: loaded.tick, owned: loaded.roster.length };
});

await page.evaluate(() => window.__game.openPanel('recruit'));
await page.waitForSelector('#management [data-view="recruit"], #management .px-recruit-layout, #management h2');
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/idea6-recruit-before-milestone-1280.png` });

const after = await page.evaluate(() => {
  window.__game.pause();
  window.__game.step(1);
  // step() mutates the live state; load() pushes it into ManagementAuthority so the panel wallet refreshes.
  const s = window.__game.getState();
  window.__game.load(s);
  window.__game.pause();
  const live = window.__game.getState();
  return {
    tickets: live.tickets,
    through: live.ticketsAwardedThroughHour,
    tick: live.tick,
    event: [...live.events].reverse().find(event => event.data.type === 'tickets'),
    wallet: window.__management?.snapshot().tickets,
  };
});

await page.evaluate(() => window.__game.openPanel('recruit'));
await page.waitForSelector('#management');
await page.waitForFunction(() => {
  const text = document.querySelector('#management')?.textContent ?? '';
  return text.includes('14 tickets') || text.includes('14 tix');
}, undefined, { timeout: 5000 });
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/idea6-recruit-milestone-1280.png` });

// Compact width too — wallet + recruit copy should still show the +8.
await page.setViewportSize({ width: 960, height: 640 });
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/idea6-recruit-milestone-960.png` });

await page.setViewportSize({ width: 480, height: 640 });
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/idea6-recruit-milestone-480.png` });

console.log(JSON.stringify({ before, after }, null, 2));
if (after.tickets !== before.tickets + 8) throw new Error(`Expected +8 tickets, got ${before.tickets} → ${after.tickets}`);
if (after.through !== 6) throw new Error(`Expected through=6, got ${after.through}`);
if (!after.event || after.event.data.amount !== 8) throw new Error(`Missing tickets event: ${JSON.stringify(after.event)}`);

await browser.close();
