/* global process, window, document, console */
/** Idea 4: gear panel with day-one spark pick-1-of-2 open at 960 (plus 1280 reference). */
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

async function injectSparkChoice(page) {
  return page.evaluate(async () => {
    window.__game.pause();
    await window.__game.whenReady();
    window.__game.setV14Rules(['chestChoice', 'farmChest', 'recruitPity', 'gearFortune', 'expeditionChests', 'offlineTickets']);
    window.__game.setSeed(7);
    const state = window.__game.getState();
    state.tick = 20 * 300; // 300 open seconds into day 1
    state.highestCleared = 5;
    state.progress = { kind: 'FARMING', stage: 5, failedStage: 6, retryAtTick: 1e9, failTick: 0, failedPower: 1e9, failures: 1 };
    delete state.pendingChoice;
    delete state.dayOneSparkAtTick;
    window.__game.load(state);

    const s = window.__game.getState();
    const itemNamespace = (seed) => {
      let value = (seed ^ 0x9e3779b9) >>> 0;
      value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
      value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
      return ((value ^ (value >>> 16)) >>> 0).toString(16).padStart(8, '0');
    };
    const ns = itemNamespace(s.seed);
    const mk = (serial, slot, rarity, dropStage, stats) => ({
      id: `itm_${ns}_${serial.toString(16).padStart(8, '0')}`,
      templateId: `gear.${slot}.${rarity}`,
      tradeable: false,
      acquiredAt: { tick: s.tick, source: 'drop' },
      slot, rarity, dropStage, level: 0, spent: 0, stats,
    });
    // Stage-5 band items — what a day-1 spark would roll while farming 1-5.
    const a = mk(s.nextGearId, 'weapon', 'rare', 5, { hp: 0, atk: 14, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 });
    s.nextGearId += 1;
    const b = mk(s.nextGearId, 'armor', 'common', 5, { hp: 40, atk: 0, def: 6, hpPct: 0, atkPct: 0, speedPct: 0 });
    s.nextGearId += 1;
    s.pendingChoice = [[a, b]];
    s.dayOneSparkAtTick = s.tick;
    s.economyRevision += 1;
    window.__game.load(s);
    window.__game.pause();
    return {
      pending: s.pendingChoice?.length ?? 0,
      dropStages: s.pendingChoice?.[0]?.map(item => item.dropStage) ?? [],
      slots: s.pendingChoice?.[0]?.map(item => `${item.rarity} ${item.slot}`) ?? [],
      sparkAt: s.dayOneSparkAtTick,
    };
  });
}

async function shotAt(width, height, path) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base, { waitUntil: 'networkidle' });
  const info = await injectSparkChoice(page);
  await page.evaluate(() => window.__game.openPanel('gear'));
  await page.waitForFunction(() => {
    const root = document.querySelector('#management');
    if (!root || root.hasAttribute('hidden')) return false;
    return !!root.querySelector('.px-chest, [aria-label="Chest choice"]');
  }, undefined, { timeout: 8000 });
  await page.waitForTimeout(200);
  const panelText = await page.locator('#management').innerText();
  await page.screenshot({ path, omitBackground: true });
  await page.close();
  return {
    ...info,
    errors,
    hasChestCopy: /CHEST:\s*PICK\s*1\s*OF\s*2/i.test(panelText),
    hasKeep: /Keep\s*[12]/i.test(panelText),
    panelSnippet: panelText.slice(0, 240).replace(/\s+/g, ' '),
  };
}

const results = {
  w960: await shotAt(960, 720, `${out}/idea4-spark-gear-960.png`),
  w1280: await shotAt(1280, 720, `${out}/idea4-spark-gear-1280.png`),
};

await browser.close();
console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some(r => r.errors?.length || r.pending < 1 || !r.hasChestCopy || !r.hasKeep)) {
  console.error('shot checks failed');
  process.exit(1);
}
console.log('done');
