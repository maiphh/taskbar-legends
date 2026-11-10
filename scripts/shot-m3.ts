// M3 shots + click checks: gacha reveal (x1, x10), welcome-back panel, sound controls, audio unlock/loop. npm run shot:m3
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from 'playwright';
import type { Browser, Page } from 'playwright';
import { preview } from 'vite';
import { CONFIG, setV14Rules, ticksForSeconds, v14RuleSchema } from '../src/config';
import { createState, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { referencePolicy } from '../src/core/policy';
import '../src/debug';

if (!process.argv.includes('--no-build')) execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
// Fixture: every v1.4 rule on, 40 open minutes of reference play (seed 3), then 20 tickets and the Legendary-pity counter at 59.
setV14Rules(v14RuleSchema.options);
const fixture = createState(3), cursor = { revision: -1 };
for (let tick = 0; tick < ticksForSeconds(40 * 60); tick += 1) { referencePolicy(fixture, cursor); step(fixture); }
referencePolicy(fixture, cursor);
fixture.tickets = 21; fixture.pityLegendary = 59; delete fixture.pendingChoice;
setV14Rules([]);
const server = await preview({ preview: { host: '127.0.0.1', port: 4177, strictPort: true } });
const base = `http://127.0.0.1:4177${process.env.VITE_BASE_PATH || '/'}`;
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const errors: string[] = [], checks: Record<string, unknown> = {};
const T0 = 1_000_000;
async function open(b: Browser, width: number, motion: 'reduce' | 'no-preference' = 'reduce'): Promise<Page> {
  const page = await b.newPage({ viewport: { width, height: CONFIG.view.canvasHeight }, deviceScaleFactor: 1, reducedMotion: motion });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${base}?shot&v14=all`, { waitUntil: 'networkidle' });
  await page.evaluate(async (state: GameState) => { localStorage.removeItem('taskbar-legends:audio'); window.__game.pause(); await window.__game.whenReady(); window.__game.load(state); }, fixture);
  await page.setViewportSize({ width, height: CONFIG.ui.expanded.height });
  return page;
}
const ui = (page: Page) => page.evaluate(() => window.__game.getLayout().ui);
const clock = (page: Page, ms: number) => page.evaluate(value => { window.__game.freezeClock(value); }, ms);
/** A control is present, wholly inside a native hit region, and clicking it does what it says. */
async function control(page: Page, id: string): Promise<{ present: boolean; inside: boolean; disabled: boolean }> {
  return page.evaluate(target => {
    const node = document.querySelector<HTMLButtonElement>(`[data-control="${target}"]`), box = node?.getBoundingClientRect(), regions = window.__game.getHitRegions();
    return { present: !!box, disabled: !!node?.disabled, inside: !!box && regions.some(r => box.left >= r.x - 0.5 && box.top >= r.y - 0.5 && box.right <= r.x + r.width + 0.5 && box.bottom <= r.y + r.height + 0.5) };
  }, id);
}
const click = async (page: Page, id: string) => { await page.click(`[data-control="${id}"]`, { force: true }); };
try {
  for (const width of [1280, 960]) {
    const page = await open(browser, width, width === 1280 ? 'no-preference' : 'reduce'), c: Record<string, unknown> = {};
    await clock(page, T0);
    await page.evaluate(() => { window.__game.openPanel('recruit'); });
    await page.waitForFunction(() => window.__game.getLayout().height > 160);
    c.audioBeforeGesture = (await page.evaluate(() => window.__game.getAudio())).unlocked;
    for (const id of ['recruit-one', 'recruit-ten', 'sound-toggle', 'volume-down', 'volume-up']) c[id] = await control(page, id);
    if (width === 1280) await page.screenshot({ path: 'shots/36-recruit-sound-controls-1280.png', omitBackground: true });
    // Sound: mute toggles and persists; volume steps by 10 %.
    await click(page, 'sound-toggle'); c.mutedAfterToggle = (await ui(page)).audio.muted;
    await click(page, 'sound-toggle'); await click(page, 'volume-up'); await click(page, 'volume-down'); await click(page, 'volume-down');
    c.audioSettings = await page.evaluate(() => ({ ui: window.__game.getLayout().ui.audio, stored: localStorage.getItem('taskbar-legends:audio'), engine: window.__game.getAudio().settings }));
    c.audioUnlockedAfterGesture = (await page.evaluate(() => window.__game.getAudio())).unlocked;
    // x1 reveal: Legendary pity (counter at 59) → Legendary with the PITY badge.
    await click(page, 'recruit-one');
    const single = await ui(page); c.singleReveal = single.reveal;
    c['reveal-skip'] = await control(page, 'reveal-skip');
    if (width === 1280) {
      await clock(page, T0 + 800); await page.screenshot({ path: 'shots/29-reveal-x1-anticipation-1280.png', omitBackground: true });
      await clock(page, T0 + 1200); await page.screenshot({ path: 'shots/30-reveal-x1-silhouette-1280.png', omitBackground: true });
      await clock(page, T0 + 2400); await page.screenshot({ path: 'shots/31-reveal-x1-legendary-pity-1280.png', omitBackground: true });
      await clock(page, T0);
    }
    await clock(page, T0 + 200); await click(page, 'reveal-skip');
    c.afterSkip = (await ui(page)).reveal; c['reveal-ok'] = await control(page, 'reveal-ok'); c['reveal-again'] = await control(page, 'reveal-again');
    await click(page, 'reveal-ok'); c.afterOk = (await ui(page)).reveal;
    // x10 reveal and summary.
    await clock(page, T0 + 10_000); await click(page, 'recruit-ten');
    c.tenReveal = (await ui(page)).reveal?.pulls.map(pull => `${pull.rarity}${pull.pity ? '/PITY' : ''}/${pull.badge}`);
    if (width === 1280) { await clock(page, T0 + 10_000 + 700); await page.screenshot({ path: 'shots/32-reveal-x10-flipping-1280.png', omitBackground: true }); }
    await clock(page, T0 + 10_000 + 3000);
    await page.screenshot({ path: `shots/${width === 1280 ? 33 : 34}-reveal-x10-summary-${width}.png`, omitBackground: true });
    c.tenDone = (await ui(page)).reveal?.done; c.tenAgain = await control(page, 'reveal-again');
    // A tab switch mid-reveal is an implicit skip: the next Recruit open shows the idle tab.
    await click(page, 'tab-gear'); await click(page, 'tab-recruit'); c.afterTabSwitch = (await ui(page)).reveal;
    c.cues = (await page.evaluate(() => window.__game.getAudio())).played;
    await page.evaluate(() => { window.__game.openPanel(null); });
    await page.waitForFunction(() => window.__game.getLayout().height === 160);
    // Welcome back: 12 h 40 m away with Expedition Chests + offline tickets + pick-1-of-2.
    await clock(page, T0 + 50_000);
    c.away = await page.evaluate(() => window.__game.away((12 * 60 + 40) * 60_000));
    await page.waitForFunction(() => window.__game.getLayout().height > 160);
    for (const id of ['welcome-collect', 'welcome-close']) c[id] = await control(page, id);
    c.welcome = (await ui(page)).welcome;
    if (width === 1280) { await clock(page, T0 + 50_000 + 600); await page.screenshot({ path: 'shots/35-welcome-back-counting-1280.png', omitBackground: true }); }
    await clock(page, T0 + 50_000 + 4000);
    await page.screenshot({ path: `shots/${width === 1280 ? 37 : 38}-welcome-back-${width}.png`, omitBackground: true });
    await click(page, 'welcome-collect');
    await page.waitForFunction(() => window.__game.getLayout().height === 160);
    c.afterCollect = (await ui(page)).welcome;
    // Collect while counting snaps, then closes after 240 ms (live clock).
    await page.evaluate(() => { window.__game.freezeClock(null); window.__game.away(3 * 3_600_000); });
    await page.waitForFunction(() => window.__game.getLayout().height > 160);
    await click(page, 'welcome-close'); c.closingAfterX = (await ui(page)).welcome?.closing ?? null;
    await page.waitForFunction(() => window.__game.getLayout().height === 160, undefined, { timeout: 3000 });
    if (width === 1280) {
      // 1.3.0 offline (rules off): 1 chest per 2 h, max 4, no tickets.
      await page.evaluate(() => { window.__game.setV14Rules([]); window.__game.freezeClock(5_000_000); window.__game.away(5 * 3_600_000 + 20 * 60_000); window.__game.freezeClock(5_010_000); });
      await page.waitForFunction(() => window.__game.getLayout().height > 160);
      c.welcome13 = (await ui(page)).welcome;
      await page.screenshot({ path: 'shots/39-welcome-back-1.3.0-1280.png', omitBackground: true });
      await click(page, 'welcome-collect'); await page.waitForFunction(() => window.__game.getLayout().height === 160);
    }
    // Persistence: reload keeps the audio settings.
    const stored = await page.evaluate(() => localStorage.getItem('taskbar-legends:audio'));
    await page.reload({ waitUntil: 'networkidle' }); await page.evaluate(() => window.__game.whenReady());
    c.audioAfterReload = { stored, engine: (await page.evaluate(() => window.__game.getAudio())).settings };
    // Unlock + loop: after a gesture the clips decode and the ambient loop starts with the engine's priming offset.
    await page.mouse.click(5, 5);
    await page.waitForFunction(() => window.__game.getAudio().loop !== null, undefined, { timeout: 15_000 }).catch(() => undefined);
    const audio = await page.evaluate(() => window.__game.getAudio());
    c.loop = { engine: audio.engine, unlocked: audio.unlocked, loaded: audio.loaded.length, loop: audio.loop };
    checks[String(width)] = c; await page.close();
  }
  // WebKit: same app, engine detection and loop window (Playwright WebKit decodes OGG, so it keeps OGG; Safari without Vorbis takes M4A).
  const wk = await webkit.launch({ headless: true });
  try {
    const page = await wk.newPage({ viewport: { width: 1280, height: 160 } });
    page.on('pageerror', error => errors.push(`webkit: ${String(error)}`));
    await page.goto(`${base}?shot`, { waitUntil: 'networkidle' }); await page.evaluate(() => window.__game.whenReady());
    await page.mouse.click(5, 5);
    await page.waitForFunction(() => window.__game.getAudio().loop !== null, undefined, { timeout: 20_000 }).catch(() => undefined);
    const audio = await page.evaluate(() => window.__game.getAudio());
    const formats = await page.evaluate(() => { const a = document.createElement('audio'); return { ogg: a.canPlayType('audio/ogg; codecs="vorbis"'), m4a: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'), mp3: a.canPlayType('audio/mpeg') }; });
    checks.webkit = { engine: audio.engine, unlocked: audio.unlocked, loaded: audio.loaded.length, loop: audio.loop, canPlayType: formats };
  } finally { await wk.close(); }
  const okFor = (width: string): boolean => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = checks[width] as Record<string, any>;
    const controls = ['recruit-one', 'recruit-ten', 'sound-toggle', 'volume-down', 'volume-up', 'reveal-skip', 'reveal-ok', 'reveal-again', 'welcome-collect', 'welcome-close'];
    return controls.every(id => c[id]?.present && c[id]?.inside) && c.audioBeforeGesture === false && c.audioUnlockedAfterGesture === true && c.mutedAfterToggle === true
      && c.singleReveal?.count === 1 && c.singleReveal?.pulls?.[0]?.rarity === 'legendary' && c.singleReveal?.pulls?.[0]?.pity === true
      && c.afterSkip?.done === true && c.afterOk === null && c.tenReveal?.length === 10 && c.tenDone === true && c.afterTabSwitch === null
      && c.welcome?.chests === 28 && c.welcome?.capped === true && c.afterCollect === null && (c.closingAfterX === true || (width === '960' && c.closingAfterX === null))
      && JSON.parse(c.audioAfterReload?.stored ?? 'null')?.volume === c.audioAfterReload?.engine?.volume
      && ['ui_click', 'gacha_pull', 'gacha_legendary_sting', 'ui_open'].every(key => (c.cues as string[]).includes(key));
  };
  const ok = okFor('1280') && okFor('960');
  await writeFile('shots/m3-checks.json', JSON.stringify({ fixture: 'seed 3, all v1.4 rules, 40 open min reference play, tickets 21, pityLegendary 59', ok, checks, errors }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok, errors }, null, 2) + '\n');
  if (!ok || errors.length) process.exitCode = 1;
} finally { await browser.close(); await new Promise<void>(resolve => { server.httpServer.close(() => resolve()); }); }
