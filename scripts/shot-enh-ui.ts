// Compact menu restyle shots + click checks (feat/enhancement-ui). npm run shot:enh-ui -- [--label before|after] [--no-build]
// Browser compact preview (?combat=party-v2&compact=1) at 1280 and 960: the lane, the menu on each tab, and the Recruit reveal.
import { writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { preview } from 'vite';

const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] ?? 'after' : 'after';
const after = label !== 'before', dir = 'shots/enh-ui';
mkdirSync(dir, { recursive: true });
if (!process.argv.includes('--no-build')) execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const server = await preview({ preview: { host: '127.0.0.1', port: 4178, strictPort: true } });
const base = `http://127.0.0.1:4178${process.env.VITE_BASE_PATH || '/'}`;
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox'] });
const errors: string[] = [], checks: Record<string, unknown> = {}, shots: string[] = [];
const HEIGHT = 560, TABS = ['party', 'stash', 'recruit', 'upgrades', 'settings'] as const;
const shot = async (page: Page, name: string): Promise<void> => { await page.mouse.move(1, 1); const path = `${dir}/${label}-${name}.png`; await page.screenshot({ path }); shots.push(path); };
/** Every visible control in the lane bar and the menu sits wholly inside a getHitRegions() rect. */
async function regionCheck(page: Page): Promise<{ controls: number; outside: string[] }> {
  return page.evaluate(() => {
    const regions = window.__game.getHitRegions(), outside: string[] = [];
    const nodes = [...document.querySelectorAll<HTMLElement>('#compact-menu-bar button, #management button, #management [data-control]')].filter(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
    for (const node of nodes) {
      // Clip to the scroll pane: rows scrolled out of view are not hit-testable controls.
      const raw = node.getBoundingClientRect(), pane = node.closest('[data-scroll]')?.getBoundingClientRect(), id = node.dataset.control ?? node.id ?? node.textContent ?? '?';
      const box = pane ? { left: Math.max(raw.left, pane.left), top: Math.max(raw.top, pane.top), right: Math.min(raw.right, pane.right), bottom: Math.min(raw.bottom, pane.bottom) } : raw;
      if (box.right <= box.left || box.bottom <= box.top) continue;
      if (!regions.some(r => box.left >= r.x - 0.5 && box.top >= r.y - 0.5 && box.right <= r.x + r.width + 0.5 && box.bottom <= r.y + r.height + 0.5)) outside.push(id);
    }
    return { controls: nodes.length, outside };
  });
}
const snap = (page: Page) => page.evaluate(() => window.__game.getState());
try {
  for (const width of [1280, 960]) {
    const page = await browser.newPage({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 1, reducedMotion: 'reduce' }), c: Record<string, unknown> = {};
    page.on('pageerror', error => errors.push(`${width}: ${String(error)}`));
    await page.goto(`${base}?shot&combat=party-v2&compact=1`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { localStorage.clear(); await window.__game.whenReady(); window.__game.setSeed(1); window.__game.freezeClock?.(1_000_000); });
    await shot(page, `lane-${width}`);
    await page.click('#compact-menu-button');
    await page.locator('#management').waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    const lane = await page.evaluate(() => { const lane = document.getElementById('game')!.getBoundingClientRect(), sheet = document.getElementById('management')!.getBoundingClientRect();
      return { lane: { top: lane.top, bottom: lane.bottom, left: lane.left, right: lane.right }, sheet: { top: sheet.top, bottom: sheet.bottom, left: sheet.left, right: sheet.right }, laneCovered: sheet.top < lane.bottom - 0.5 && sheet.bottom > lane.top + 0.5 && sheet.left < lane.right - 0.5 && sheet.right > lane.left + 0.5 }; });
    c.layout = lane;
    for (const tab of TABS) {
      await page.click(`[data-tab="${tab}"]`); await page.waitForTimeout(250);
      await shot(page, `menu-${tab}-${width}`);
      c[`${tab}Regions`] = await regionCheck(page);
    }
    if (after) {
      const fresh = await snap(page);
      c.freshInventory = fresh.inventory.map(item => `${item.rarity} ${item.slot} ${item.acquiredAt.source}`);
      c.freshEquipped = fresh.roster.filter(hero => Object.values(hero.equipment).some(Boolean)).map(hero => hero.id);
      // Stash: pick the first item, cycle the compare target and filters with the pixel controls.
      await page.click('[data-tab="stash"]');
      await page.click('[data-dd-toggle="slot"]'); await shot(page, `menu-stash-dropdown-${width}`); c.dropdownRegions = await regionCheck(page);
      await page.click('[data-dd-option="slot"][data-value="weapon"]'); c.slotFilterVisible = await page.locator('[data-gear]').count();
      await page.click('[data-dd-toggle="slot"]'); await page.keyboard.press('Escape'); c.dropdownEscClosed = await page.locator('[data-dd-option="slot"]').count() === 0;
      await page.click('[data-dd-toggle="slot"]'); await page.click('[data-dd-option="slot"][data-value="all"]');
      await page.locator('[data-gear]').first().click(); await page.waitForTimeout(300);
      await shot(page, `menu-stash-selected-${width}`);
      c.stashSelectedRegions = await regionCheck(page);
      const ownerBefore = await page.locator('[data-dd-toggle="owner"]').getAttribute('aria-label');
      await page.click('[data-dd-toggle="owner"]'); await page.locator('[data-dd-option="owner"]').nth(1).click();
      c.ownerChanged = [ownerBefore, await page.locator('[data-dd-toggle="owner"]').getAttribute('aria-label')];
      await page.click('[data-dd-toggle="owner"]'); await page.click('[data-dd-option="owner"][data-value="all"]');
      await page.click('[data-tab="upgrades"]'); c.upgradeRows = await page.locator('[data-gear]').count();
      c.upgradeDisabledAtZeroGold = !(await page.locator('[data-action="upgrade"]').isEnabled());
      await page.evaluate(() => { const state = window.__game.getState(); state.gold = 5000; window.__game.load(state); window.__game.pause(); }); await page.waitForTimeout(400);
      await page.locator('[data-gear]').first().click(); await page.waitForTimeout(200);
      c.upgradeEnabled = await page.locator('[data-action="upgrade"]').isEnabled();
      const levelBefore = (await snap(page)).inventory.reduce((sum, item) => sum + item.level, 0);
      await page.click('[data-action="upgrade"]'); await page.waitForTimeout(300);
      c.upgradeApplied = (await snap(page)).inventory.reduce((sum, item) => sum + item.level, 0) - levelBefore;
      await shot(page, `menu-upgrades-gold-${width}`);
      // Settings: toggles, the four sliders (keyboard + pointer), zoom pair and placement dropdown.
      await page.click('[data-tab="settings"]');
      const volume0 = (await page.evaluate(() => window.__game.getAudio().settings.volume));
      await page.focus('[data-slider="master"]'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
      c.volumeStep = [volume0, await page.evaluate(() => window.__game.getAudio().settings.volume)];
      await page.keyboard.press('ArrowLeft');
      const music = page.locator('[data-slider="music"]'), musicBox = (await music.boundingBox())!;
      await page.mouse.click(musicBox.x + 4 + (musicBox.width - 8) * 0.25, musicBox.y + musicBox.height / 2); await page.waitForTimeout(100);
      c.musicBus = await page.evaluate(() => window.__game.getAudio().settings.buses?.music ?? null);
      c.sliderCount = await page.locator('[data-slider]').count();
      await page.click('[data-action="mute"]'); c.muteToggled = await page.evaluate(() => window.__game.getAudio().settings.muted);
      await page.click('[data-action="mute"]');
      c.settingsRegions = await regionCheck(page);
      await page.click('[data-tab="party"]');
      await page.click('[data-dd-toggle="party-preset"]'); await page.click('[data-dd-option="party-preset"][data-value="fastFarm"]');
      await page.waitForFunction(() => window.__game.getState().partyPreset === 'fastFarm');
      c.presetApplied = (await snap(page)).partyPreset;
      // Recruit → gacha reveal (x1 and x10) in the menu, clock frozen for stable frames.
      await page.evaluate(() => { const state = window.__game.getState(); state.tickets = 30; window.__game.load(state); window.__game.pause(); });
      await page.click('[data-tab="recruit"]'); await page.waitForTimeout(300);
      await page.evaluate(() => { window.__game.freezeClock(1_000_000); });
      await page.click('[data-action="pull-one"]');
      await page.waitForFunction(() => !!document.querySelector('#management .reveal-stage:not([hidden]) canvas'));
      await page.evaluate(() => { window.__game.freezeClock(1_000_000 + 5000); }); await page.waitForTimeout(250);
      await shot(page, `reveal-x1-${width}`);
      c.revealX1 = await page.evaluate(() => window.__game.getManagementReveal?.() ?? null);
      c.revealRegions = await regionCheck(page);
      await page.click('[data-control="reveal-ok"]', { force: true }); await page.waitForTimeout(200);
      c.revealClosedAfterOk = await page.evaluate(() => window.__game.getManagementReveal?.() ?? null);
      await page.evaluate(() => { window.__game.freezeClock(2_000_000); });
      await page.click('[data-action="pull-ten"]');
      await page.waitForFunction(() => !!document.querySelector('#management .reveal-stage:not([hidden]) canvas'));
      await page.evaluate(() => { window.__game.freezeClock(2_000_000 + 8000); }); await page.waitForTimeout(250);
      await shot(page, `reveal-x10-${width}`);
      c.revealX10 = await page.evaluate(() => window.__game.getManagementReveal?.() ?? null);
      c.revealX10Regions = await regionCheck(page);
      await page.click('[data-control="reveal-again"]', { force: true }); await page.waitForTimeout(200);
      c.againPulls = (await snap(page)).stats.pulls;
      await page.click('[data-tab="stash"]'); await page.waitForTimeout(200);
      c.revealClearedByTab = await page.evaluate(() => window.__game.getManagementReveal?.() ?? null);
      await page.click('[data-close]'); await page.locator('#management').waitFor({ state: 'hidden' });
      c.closedRegions = await regionCheck(page);
      // Edit mode: Done replaces Edit, Move/Resize sit on the HUD band and are hit-testable.
      await page.click('#compact-edit-button'); await page.waitForTimeout(150);
      await shot(page, `lane-edit-${width}`);
      c.editOutside = await page.evaluate(() => { const regions = window.__game.getHitRegions(); return ['drag-handle', 'resize-handle', 'edit-done'].filter(id => { const box = document.getElementById(id)!.getBoundingClientRect();
        return box.width > 0 && !regions.some(r => box.left >= r.x - 0.5 && box.top >= r.y - 0.5 && box.right <= r.x + r.width + 0.5 && box.bottom <= r.y + r.height + 0.5); }); });
      c.editHidesEdit = await page.locator('#compact-edit-button').isHidden();
      await page.click('#edit-done');
    }
    checks[width] = c; await page.close();
  }
  if (after) {
    // compactMenu.browser.openWindow (640×568): room above the lane, so the panel docks above it (preferDock).
    const page = await browser.newPage({ viewport: { width: 640, height: 568 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(`640: ${String(error)}`));
    await page.goto(`${base}?shot&combat=party-v2&compact=1`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { localStorage.clear(); await window.__game.whenReady(); window.__game.setSeed(1); window.__game.freezeClock?.(1_000_000); });
    await shot(page, 'lane-640');
    await page.click('#compact-menu-button'); await page.waitForTimeout(300);
    for (const tab of TABS) { await page.click(`[data-tab="${tab}"]`); await page.waitForTimeout(250); await shot(page, `menu-${tab}-640`); }
    checks[640] = { dock: await page.evaluate(() => document.getElementById('management')!.dataset.dock), regions: await regionCheck(page) };
    await page.close();
    // Native-window variant (760×560) rendered in the page, for the tab mockups (mockup-compact-menu-{tab}.png).
    const native = await browser.newPage({ viewport: { width: 760, height: 560 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    native.on('pageerror', error => errors.push(`native: ${String(error)}`));
    await native.goto(`${base}?shot&combat=party-v2&compact=1&menu=native`, { waitUntil: 'networkidle' });
    await native.evaluate(async () => { localStorage.clear(); await window.__game.whenReady(); window.__game.setSeed(1); window.__game.freezeClock?.(1_000_000); });
    await native.click('#compact-menu-button'); await native.waitForTimeout(300);
    for (const tab of TABS) { await native.click(`[data-tab="${tab}"]`); await native.waitForTimeout(250); await shot(native, `native-${tab}`); }
    checks.native = { regions: await regionCheck(native) };
    await native.close();
  }
  if (after) {
    // Mockup-vs-shot sheets (ui/compact-menu-*.png from the Graphic Designer's spec), side by side at 1×.
    const mockups = process.env.COMPACT_MENU_MOCKUPS ?? '/workspace/game-assets/idle-battler/ui';
    const pairs: [string, string, string][] = [['lane', `${mockups}/mockup-compact-menu-lane.png`, `${dir}/after-lane-edit-960.png`], ['browser', `${mockups}/mockup-compact-menu-browser.png`, `${dir}/after-menu-party-640.png`],
      ['native', `${mockups}/mockup-compact-menu-native.png`, `${dir}/after-native-party.png`], ...TABS.map(tab => [tab, `${mockups}/mockup-compact-menu-${tab}.png`, `${dir}/after-native-${tab}.png`] as [string, string, string])];
    const { readFile } = await import('node:fs/promises');
    const page = await browser.newPage({ viewport: { width: 1600, height: 700 }, deviceScaleFactor: 1 });
    for (const [name, mockup, actual] of pairs) {
      if (!existsSync(mockup) || !existsSync(actual)) continue;
      const data = async (path: string) => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
      await page.setContent(`<body style="margin:0;background:#0d121b;color:#f2e9cf;font:12px monospace;display:flex;gap:16px;padding:8px;align-items:flex-start;width:max-content"><figure style="margin:0"><figcaption>mockup: ${mockup.split('/').pop()}</figcaption><img src="${await data(mockup)}" style="image-rendering:pixelated;display:block"></figure><figure style="margin:0"><figcaption>shot: ${actual.split('/').pop()}</figcaption><img src="${await data(actual)}" style="image-rendering:pixelated;display:block"></figure></body>`);
      const path = `${dir}/compare-${name}.png`; await page.locator('body').screenshot({ path }); shots.push(path);
    }
    await page.close();
  }
} finally { await browser.close(); await new Promise<void>(resolve => server.httpServer.close(() => resolve())); }
const failures: string[] = [];
if (after) for (const [width, value] of Object.entries(checks).filter(([key]) => key !== '640' && key !== 'native') as [string, Record<string, unknown>][]) {
  const layout = value.layout as { laneCovered: boolean };
  if (layout.laneCovered) failures.push(`${width}: menu covers the lane`);
  for (const [key, entry] of Object.entries(value)) if (key.endsWith('Regions') && (entry as { outside: string[] }).outside.length) failures.push(`${width}: ${key} outside hit regions: ${(entry as { outside: string[] }).outside.join(', ')}`);
  if (!(value.freshInventory as string[]).length) failures.push(`${width}: fresh seed has an empty stash`);
  if (!value.upgradeRows) failures.push(`${width}: no upgrade rows on a fresh seed`);
  if (!value.upgradeEnabled || value.upgradeApplied !== 1) failures.push(`${width}: upgrade did not apply with gold`);
  if (value.sliderCount !== 4) failures.push(`${width}: expected four volume sliders`);
  if (!value.dropdownEscClosed) failures.push(`${width}: Esc did not close the dropdown`);
  if ((value.editOutside as string[]).length || !value.editHidesEdit) failures.push(`${width}: edit controls ${(value.editOutside as string[]).join(', ')} outside hit regions or Edit still shown`);
  if (!(value.revealX1 as { count?: number } | null)?.count) failures.push(`${width}: x1 reveal did not start`);
  if ((value.revealX10 as { count?: number } | null)?.count !== 10) failures.push(`${width}: x10 reveal did not start`);
  if (value.revealClosedAfterOk !== null) failures.push(`${width}: OK did not close the reveal`);
  if (value.revealClearedByTab !== null) failures.push(`${width}: tab change did not clear the reveal`);
}
const report = { label, ok: !errors.length && !failures.length, errors, failures, shots, checks };
await writeFile(`${dir}/${label}-checks.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, errors, failures, shots: shots.length }, null, 2));
if (!report.ok && after) process.exitCode = 1;
