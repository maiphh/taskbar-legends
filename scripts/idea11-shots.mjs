/* global window, document, localStorage, process, console */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = '.grok-run/shots';
const chrome = process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome';

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

async function shot(width) {
  const context = await browser.newContext({
    viewport: { width: Math.max(width + 40, 520), height: 220 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(sourceWidth => {
    localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({
      version: 1, sourceWidth, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1,
    }));
  }, width);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(async () => {
    window.__game.pause();
    await window.__game.whenReady();
  });
  const info = await page.evaluate(async sourceWidth => {
    const [{ createState, statusText, wipeStatusText, step }, { beginEncounter }] = await Promise.all([
      import('/src/core/game.ts'),
      import('/src/core/combat.ts'),
    ]);
    window.__game.pause();
    const state = createState(11, { starterGear: false });
    state.highestCleared = 8;
    state.retryFailures = 0;
    state.progress = { kind: 'PUSHING', stage: 9 };
    beginEncounter(state);
    for (const hero of state.party) hero.hp = 0;
    step(state, 1);
    window.__game.load(state);
    window.__game.openPanel(null);
    document.getElementById('management')?.setAttribute('hidden', '');
    const after = window.__game.getState();
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const bandW = Math.min(canvas.width, sourceWidth < 640 ? 280 : 420);
    const band = ctx.getImageData(0, 30, bandW, 40);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = bandW;
    outCanvas.height = 40;
    outCanvas.getContext('2d').putImageData(band, 0, 0);
    return {
      progress: after.progress,
      lastLoss: after.lastLoss,
      status: statusText(after),
      compactStatus: statusText(after, { compact: true }),
      wipe: wipeStatusText(after, sourceWidth < 640),
      liveStatus: document.getElementById('live-status')?.textContent ?? '',
      layout: window.__game.getLayout(),
      bandDataUrl: outCanvas.toDataURL('image/png'),
    };
  }, width);
  await page.waitForTimeout(120);
  const path = `${out}/idea11-wipe-${width}.png`;
  const clip = await page.evaluate(() => {
    const app = document.getElementById('app') ?? document.getElementById('game');
    const rect = app.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
    };
  });
  await page.screenshot({ path, clip });
  const bandPath = `${out}/idea11-wipe-band-${width}.png`;
  await writeFile(bandPath, Buffer.from(info.bandDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
  await context.close();
  if (errors.length) throw new Error(`page errors @${width}: ${errors.join('; ')}`);
  const { bandDataUrl: _band, ...rest } = info;
  return { width, path, bandPath, ...rest };
}

const results = [];
for (const width of [1280, 640, 480]) results.push(await shot(width));
await browser.close();
console.log(JSON.stringify(results, null, 2));
