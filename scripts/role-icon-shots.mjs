/* global window, document */
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  window.__game.pause();
  window.__management?.freezeAnimation(true);
  await window.__game.whenReady();
  window.__game.setSeed(4721);
  window.__game.step(4000);
  const state = window.__game.getState();
  const template = state.roster[0];
  if (template) {
    for (const id of ['mw1', 'priest', 'hu1', 'wiz', 'mh1', 'hk1']) {
      if (!state.roster.some(hero => hero.id === id) && state.roster.length < 12) {
        state.roster.push({ ...JSON.parse(JSON.stringify(template)), id, level: 8, stars: 2, xp: 0, equipment: { weapon: null, armor: null, charm: null } });
      }
    }
  }
  state.partyIds = ['mw2', 'hu1', 'priest'];
  state.gold = Math.max(state.gold, 5000);
  state.tickets = Math.max(state.tickets, 20);
  window.__game.load(state);
  window.__game.openPanel('home');
  window.__management?.freezeAnimation(true);
});
await page.waitForSelector('#management:not([hidden]) [data-view="home"]');

async function shot(name, selector) {
  if (selector) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: 'visible', timeout: 10000 });
    await el.screenshot({ path: `${out}/${name}.png` });
  } else {
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  console.log('wrote', name);
}

await shot('role-home-party', '#management [data-view="home"]');
await page.evaluate(() => window.__game.openPanel('formation'));
await page.waitForSelector('#management [data-view="formation"]');
await shot('role-formation', '#management [data-view="formation"]');
await page.evaluate(() => window.__game.openPanel('heroes'));
await page.waitForSelector('#management [data-view="heroes"]');
await shot('role-heroes-roster', '#management [data-view="heroes"]');
await page.locator('#management [data-view="heroes"] [data-hero="mw2"]').click();
await page.waitForSelector('#management .px-v2-detail');
await shot('role-hero-detail', '#management .px-v2-detail');
await page.locator('#management .px-v2-detail [data-loadout-slot="weapon"]').first().click();
await page.waitForSelector('#management [data-view="equip"] .px-equip-screen');
await shot('role-equip', '#management [data-view="equip"]');
await page.locator('#management [data-view="equip"] [data-equip-back]').click();
await page.locator('#management [data-details-close]').click();
await page.locator('#management [data-locked-hero]').first().click();
await page.waitForSelector('#management .px-howto-card');
await shot('role-howto-locked', '#management .px-howto-card');
await page.keyboard.press('Escape');
// Tooltip with role text — hover a formation card that has data-help including role
await page.evaluate(() => window.__game.openPanel('formation'));
await page.waitForSelector('#management [data-view="formation"] [data-hero]');
await page.locator('#management [data-view="formation"] [data-hero]').first().hover();
await page.waitForTimeout(300);
await shot('role-formation-tooltip', null);
// Recruit reveal canvas (draws role icons via canvas paths)
await page.evaluate(() => {
  window.__game.openPanel('recruit');
});
await page.waitForSelector('#management [data-view="recruit"]');
await page.evaluate(() => {
  // Trigger a reveal through the management reveal path if available
  const pulls = [
    { heroId: 'mw2', rarity: 'rare', pity: false, duplicate: false },
    { heroId: 'hu1', rarity: 'common', pity: false, duplicate: false },
    { heroId: 'priest', rarity: 'epic', pity: false, duplicate: false },
  ];
  // Prefer management reveal so drawManagementRole runs
  if (window.__management?.playReveal) {
    window.__management.playReveal(1, [pulls[0]]);
  } else if (window.__ui?.playReveal) {
    window.__ui.playReveal(1, [pulls[0]]);
  } else {
    // Fall back: pull once if tickets allow
    window.__game.input({ type: 'pull' });
  }
});
await page.waitForTimeout(500);
await shot('role-recruit-reveal', null);
// Crop each role badge alone for clarity
for (const [role, sel] of [['tank', '.px-v2-role.tank'], ['dps', '.px-v2-role.dps'], ['support', '.px-v2-role.support']]) {
  await page.evaluate(() => window.__game.openPanel('heroes'));
  await page.waitForSelector('#management [data-view="heroes"]');
  const badge = page.locator(sel).first();
  if (await badge.count()) {
    await badge.screenshot({ path: `${out}/role-badge-${role}.png` });
    console.log('wrote role-badge-' + role);
  }
}
await browser.close();
console.log('done');
