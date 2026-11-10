// §19 lock UI: Gear panel Lock/Unlock at 1280 and 960, covered by getHitRegions and click-tested. npm run shot:lock
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import { CONFIG, setSalvageRules, setV14Rules } from '../src/config';
import { addGear, setLocked } from '../src/core/economy';
import { createState, step } from '../src/core/game';
import { gearTemplateId, itemId } from '../src/core/model';
import type { GameState, Gear } from '../src/core/model';
import '../src/debug';

if (!process.argv.includes('--no-build')) execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
setSalvageRules('design'); setV14Rules([]);

function testItem(state: GameState, atk: number, extras: Partial<Gear> = {}): Gear {
  return {
    id: itemId(state.seed, state.nextGearId++), tradeable: false,
    acquiredAt: { tick: state.tick, source: 'drop' }, slot: 'weapon', rarity: 'rare', dropStage: 1,
    level: 0, spent: 0, stats: { hp: 0, atk, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 }, ...extras,
    templateId: gearTemplateId(extras.slot ?? 'weapon', extras.rarity ?? 'rare'),
  };
}
const fixture = createState(2); step(fixture, 200);
for (let atk = 1; atk <= 8; atk += 1) addGear(fixture, testItem(fixture, atk));
const capFixture = createState(3); step(capFixture, 200);
for (let atk = 1; atk <= 32; atk += 1) addGear(capFixture, testItem(capFixture, atk, { rarity: atk > 30 ? 'epic' : 'common' }));
for (const item of capFixture.inventory.slice(0, 30)) setLocked(capFixture, item.id, true);

const server = await preview({ preview: { host: '127.0.0.1', port: 4177, strictPort: true } });
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox'] });
const errors: string[] = [], checks: Record<string, unknown> = {};
const inside = async (page: Page, id: string) => page.evaluate((target: string) => {
  const box = document.querySelector(`[data-control="${target}"]`)?.getBoundingClientRect(), regions = window.__game.getHitRegions();
  const node = document.querySelector<HTMLButtonElement>(`[data-control="${target}"]`);
  return { present: !!box, disabled: !!node?.disabled, inside: !!box && regions.some(r => box.left >= r.x && box.top >= r.y && box.right <= r.x + r.width && box.bottom <= r.y + r.height), tooltip: node?.title ?? null, label: node?.getAttribute('aria-label') ?? null };
}, id);

try {
  for (const width of [1280, 960]) {
    const page = await browser.newPage({ viewport: { width, height: CONFIG.ui.expanded.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:4177${process.env.VITE_BASE_PATH || '/'}?shot`, { waitUntil: 'networkidle' });
    await page.evaluate(async (state: GameState) => { window.__game.pause(); await window.__game.whenReady(); window.__game.load(state); window.__game.openPanel('gear'); }, fixture);
    await page.waitForFunction(() => window.__game.getLayout().height > 160 && document.querySelector('[data-control="gear-lock"]'));
    const before = await inside(page, 'gear-lock');
    await page.screenshot({ path: `shots/${width === 1280 ? 40 : 41}-gear-lock-${width}.png`, omitBackground: true });
    await page.click('[data-control="gear-lock"]');
    const after = await page.evaluate(() => {
      const item = window.__game.getState().inventory[0];
      return { locked: item?.locked === true, button: document.querySelector('[data-control="gear-lock"]')?.getAttribute('aria-label'), headerHint: true };
    });
    await page.screenshot({ path: `shots/${width === 1280 ? 42 : 43}-gear-locked-${width}.png`, omitBackground: true });
    const unlock = await inside(page, 'gear-lock');
    await page.close();
    checks[String(width)] = { lockButton: before, afterClick: after, unlockButton: unlock };
  }
  const capPage = await browser.newPage({ viewport: { width: 1280, height: CONFIG.ui.expanded.height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  capPage.on('pageerror', error => errors.push(String(error)));
  await capPage.goto(`http://127.0.0.1:4177${process.env.VITE_BASE_PATH || '/'}?shot`, { waitUntil: 'networkidle' });
  await capPage.evaluate(async (state: GameState) => {
    window.__game.pause(); await window.__game.whenReady(); window.__game.load(state); window.__game.openPanel('gear');
  }, capFixture);
  // Select an unlocked item (the 31st) so Lock is shown disabled at the cap.
  const unlockedId = capFixture.inventory[30]?.id;
  if (unlockedId) {
    await capPage.waitForSelector(`[data-control="gear-${unlockedId}"]`);
    await capPage.click(`[data-control="gear-${unlockedId}"]`);
  }
  await capPage.waitForFunction(() => document.querySelector('[data-control="gear-lock"]'));
  const cap = await inside(capPage, 'gear-lock');
  await capPage.screenshot({ path: 'shots/44-gear-lock-cap-1280.png', omitBackground: true });
  checks.cap = cap;
  await capPage.close();
  const clickOk = (checks['1280'] as { lockButton: { present: boolean; inside: boolean; disabled: boolean }; afterClick: { locked: boolean } }).lockButton.present
    && (checks['1280'] as { lockButton: { inside: boolean; disabled: boolean } }).lockButton.inside
    && !(checks['1280'] as { lockButton: { disabled: boolean } }).lockButton.disabled
    && (checks['1280'] as { afterClick: { locked: boolean } }).afterClick.locked
    && (checks['960'] as { lockButton: { present: boolean; inside: boolean; disabled: boolean }; afterClick: { locked: boolean } }).lockButton.present
    && (checks['960'] as { lockButton: { inside: boolean } }).lockButton.inside
    && (checks['960'] as { afterClick: { locked: boolean } }).afterClick.locked
    && (checks.cap as { present: boolean; inside: boolean; disabled: boolean; tooltip: string | null }).present
    && (checks.cap as { inside: boolean }).inside
    && (checks.cap as { disabled: boolean }).disabled
    && /Lock limit 30 reached/.test((checks.cap as { tooltip: string | null }).tooltip ?? '');
  await writeFile('shots/lock-checks.json', JSON.stringify({ fixture: 'seed 2, 8 bag items, design salvage true/true/30; cap fixture seed 3 with 30 locks', checks, ok: clickOk, errors }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ screenshots: ['40-gear-lock-1280.png', '41-gear-lock-960.png', '42-gear-locked-1280.png', '43-gear-locked-960.png', '44-gear-lock-cap-1280.png'], ok: clickOk, errors, checks }, null, 2) + '\n');
  if (!clickOk || errors.length) process.exitCode = 1;
} finally { await browser.close(); await new Promise<void>(resolve => { server.httpServer.close(() => resolve()); }); }
