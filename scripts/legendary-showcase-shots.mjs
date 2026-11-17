/* global process, window */
import { copyFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.MANAGEMENT_BASE_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), headless: true, args: ['--no-sandbox'] });
await mkdir('artifacts/legendary', { recursive: true });
try {
  for (const reduced of [true, false]) {
    const mode = reduced ? 'reduced' : 'motion';
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await window.__game.whenReady(); window.__game.pause(); });
    for (const kind of ['skill', 'drop']) {
      await page.evaluate(value => window.__game.debugShowcase(value), kind);
      for (let frame = 0; frame < 6; frame++) {
        await page.waitForTimeout(150);
        const path = `artifacts/legendary/${mode}-${kind}-${frame + 1}.png`;
        await page.screenshot({ path });
        if (reduced) await copyFile(path, `artifacts/legendary/${kind}-${frame + 1}.png`);
      }
    }
    await page.evaluate(() => { window.__game.openPanel('home'); window.__game.debugShowcase('drop'); });
    const toastPath = `artifacts/legendary/${mode}-management-toast.png`;
    await page.screenshot({ path: toastPath });
    if (reduced) await copyFile(toastPath, 'artifacts/legendary/management-toast.png');
    await page.close();
  }
} finally { await browser.close(); }
