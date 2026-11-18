/* global process, window */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
const base = process.env.MANAGEMENT_BASE_URL ?? 'http://127.0.0.1:5173/';
const count = Math.max(2, Number(process.env.LEGENDARY_FRAMES ?? 8));
const browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), headless: true, args: ['--no-sandbox'] });
await mkdir('artifacts/legendary', { recursive: true });
for (const file of await readdir('artifacts/legendary')) if (/^(reduced|motion)-(skill|drop)-\d+\.png$/.test(file)) await rm(`artifacts/legendary/${file}`);
try {
  for (const reduced of [true, false]) {
    const mode = reduced ? 'reduced' : 'motion';
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await window.__game.whenReady(); window.__game.pause(); });
    for (const kind of ['skill', 'drop']) {
      await page.evaluate(value => window.__game.debugShowcase(value), kind);
      const duration = kind === 'skill' ? 1100 : 1000;
      for (let frame = 0; frame < count; frame++) {
        const age = Math.round((duration - 1) * frame / (count - 1));
        await page.evaluate(ms => window.__game.debugShowcaseSeek(ms), age);
        const path = `artifacts/legendary/${mode}-${kind}-${String(frame + 1).padStart(2, '0')}.png`;
        await page.locator('#game').screenshot({ path });
        if (reduced) await page.locator('#game').screenshot({ path: `artifacts/legendary/${kind}-${String(frame + 1).padStart(2, '0')}.png` });
      }
      const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      if (!ffmpeg.error && ffmpeg.status === 0) {
        spawnSync('ffmpeg', ['-y', '-framerate', '8', '-pattern_type', 'glob', '-i', `artifacts/legendary/${mode}-${kind}-*.png`, '-vf', 'scale=iw*3:ih*3:flags=neighbor', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', `artifacts/legendary/${mode}-${kind}.webm`], { stdio: 'ignore' });
      }
    }
    await page.evaluate(() => { window.__game.openPanel('home'); window.__game.debugShowcase('drop'); });
    await page.locator('#management .px-legendary-toast').screenshot({ path: `artifacts/legendary/${mode}-management-toast.png` }).catch(async () => page.locator('#legendary-toast').screenshot({ path: `artifacts/legendary/${mode}-management-toast.png` }));
    await page.close();
  }
} finally { await browser.close(); }
