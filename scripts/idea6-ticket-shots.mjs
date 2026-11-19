/* global process, window, document, console */
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

/** Wallet must be on-screen with the post-milestone ticket count before we claim a shot shows it. */
async function assertWalletVisible(page, expectedTix) {
  const info = await page.evaluate(expected => {
    const wallet = document.querySelector('#management [data-wallet]');
    if (!wallet) return { ok: false, reason: 'missing [data-wallet]' };
    const text = wallet.textContent ?? '';
    if (!text.includes(`${expected} tix`)) return { ok: false, reason: `wallet text="${text}"` };
    const box = wallet.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const inside = box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= vw && box.bottom <= vh;
    return { ok: inside, reason: inside ? 'ok' : `wallet box=${JSON.stringify({ left: box.left, top: box.top, right: box.right, bottom: box.bottom })} vw=${vw} vh=${vh}` };
  }, expectedTix);
  if (!info.ok) throw new Error(`Wallet not visible with ${expectedTix} tix: ${info.reason}`);
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await prep(page);

const before = await page.evaluate(() => {
  window.__game.pause();
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
await assertWalletVisible(page, 14);
await page.screenshot({ path: `${out}/idea6-recruit-milestone-1280.png` });

// Compact width too — wallet + recruit copy should still show the +8.
await page.setViewportSize({ width: 960, height: 640 });
await page.waitForTimeout(150);
await assertWalletVisible(page, 14);
await page.screenshot({ path: `${out}/idea6-recruit-milestone-960.png` });

// 480 is narrower than the v2 overlay (fitManagementOverlay keeps a 960 panel), so the
// header wallet is clipped. Do not write a 480 shot that claims to show the wallet.

console.log(JSON.stringify({ before, after }, null, 2));
if (after.tickets !== before.tickets + 8) throw new Error(`Expected +8 tickets, got ${before.tickets} → ${after.tickets}`);
if (after.through !== 6) throw new Error(`Expected through=6, got ${after.through}`);
if (!after.event || after.event.data.amount !== 8) throw new Error(`Missing tickets event: ${JSON.stringify(after.event)}`);

await browser.close();
