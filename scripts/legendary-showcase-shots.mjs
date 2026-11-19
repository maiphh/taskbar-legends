/* global process, window, document, localStorage */
import { mkdir, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.MANAGEMENT_BASE_URL ?? 'http://127.0.0.1:5173/';
const frames = 8;
const durations = { skill: 1800, drop: 2100 };
const out = 'artifacts/legendary';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), headless: true, args: ['--no-sandbox'] });
await mkdir(out, { recursive: true });
for (const file of await readdir(out)) if (/^(reduced|motion|pref)-(skill|drop)-\d+\.png$/.test(file) || /^(reduced|motion)-management-toast-\d+\.png$/.test(file) || /^motion-drop-(armor|charm)\.png$/.test(file)) await rm(`${out}/${file}`);
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.error?.message ?? result.stderr}`);
};
const assertFile = async path => { const value = await stat(path); if (!value.isFile() || value.size === 0) throw new Error(`Expected a non-empty output file: ${path}`); };
const assertToastPixelSteps = async page => page.evaluate(() => {
  const toast = document.querySelector('#management .px-legendary-toast:not([hidden]), #legendary-toast:not([hidden])');
  if (!toast) throw new Error('Expected an active legendary toast for pixel-step verification');
  const animation = toast.getAnimations().find(item => item.animationName === 'legendary-pop-in');
  if (!animation) throw new Error('Expected the legendary toast entrance animation');
  for (let ms = 0; ms <= 360; ms += 10) {
    animation.currentTime = ms;
    const style = window.getComputedStyle(toast), matrix = new window.DOMMatrixReadOnly(style.transform), top = toast.getBoundingClientRect().top;
    if (!Number.isInteger(matrix.m42) || !Number.isInteger(top)) throw new Error(`Toast left the integer pixel grid at ${ms}ms: translateY=${matrix.m42}, top=${top}`);
  }
});
try {
  for (const reduced of [true, false]) {
    const mode = reduced ? 'reduced' : 'motion';
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await window.__game.whenReady(); window.__game.pause(); });
    const lane = await page.evaluate(() => { const layout = window.__game.getLayout(); const canvas = document.querySelector('#game'); const rect = canvas.getBoundingClientRect(); const scale = rect.width / layout.width; return { x: rect.left + Math.floor((layout.width - 640) / 2) * scale, y: rect.top, width: Math.min(640, layout.width) * scale, height: 160 * scale }; });
    for (const kind of ['skill', 'drop']) {
      await page.evaluate(value => { window.__game.debugShowcase(value); if (value === 'drop') document.querySelector('#notice').textContent = ''; }, kind);
      const ages = Array.from({ length: frames }, (_, index) => Math.floor(durations[kind] * index / frames));
      for (let frame = 0; frame < frames; frame++) {
        const age = ages[frame];
        await page.evaluate(ms => window.__game.debugShowcaseSeek(ms), age);
        const path = `${out}/${mode}-${kind}-${String(frame + 1).padStart(2, '0')}.png`;
        await page.screenshot({ path, clip: { x: lane.x, y: lane.y, width: lane.width, height: lane.height } });
        if (reduced) await page.screenshot({ path: `${out}/${kind}-${String(frame + 1).padStart(2, '0')}.png`, clip: { x: lane.x, y: lane.y, width: lane.width, height: lane.height } });
      }
      if (ffmpeg) {
        const prefix = `${out}/${mode}-${kind}`;
        const concat = `${prefix}-timeline.txt`;
        const entries = ages.map((age, index) => {
          const next = ages[index + 1] ?? durations[kind];
          return `file '${resolve(`${prefix}-${String(index + 1).padStart(2, '0')}.png`)}'\nduration ${((next - age) / 1000).toFixed(3)}`;
        });
        entries.push(`file '${resolve(`${prefix}-${String(frames).padStart(2, '0')}.png`)}'`);
        await writeFile(concat, `${entries.join('\n')}\n`);
        run('ffmpeg', ['-y', '-framerate', '1', '-start_number', '1', '-i', `${prefix}-%02d.png`, '-vf', 'scale=iw*2:ih*2:flags=neighbor,tile=4x2', '-frames:v', '1', `${out}/${kind}-sequence.png`]);
        run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-fps_mode', 'vfr', '-vf', 'scale=iw*2:ih*2:flags=neighbor', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', `${out}/${mode}-${kind}.webm`]);
        run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-fps_mode', 'vfr', '-vf', 'scale=iw*2:ih*2:flags=neighbor,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', `${out}/${mode}-${kind}.gif`]);
        await Promise.all([`${out}/${kind}-sequence.png`, `${out}/${mode}-${kind}.webm`, `${out}/${mode}-${kind}.gif`].map(assertFile));
        for (const extension of ['webm', 'gif']) {
          const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', `${out}/${mode}-${kind}.${extension}`], { encoding: 'utf8' });
          if (probe.status !== 0 || Math.abs(Number(probe.stdout.trim()) - durations[kind] / 1000) > 0.12) throw new Error(`Unexpected ${mode} ${kind} ${extension} duration: ${probe.stdout.trim()}`);
        }
      }
    }
    if (!reduced) {
      for (const [kind, age] of [['skill', 1790], ['drop', 2090]]) {
        await page.evaluate(value => { window.__game.debugShowcase(value); if (value === 'drop') document.querySelector('#notice').textContent = ''; }, kind);
        await page.evaluate(ms => window.__game.debugShowcaseSeek(ms), age);
        await page.screenshot({ path: `${out}/motion-${kind}-late.png`, clip: { x: lane.x, y: lane.y, width: lane.width, height: lane.height } });
      }
      const pixelPage = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
      await pixelPage.goto(base, { waitUntil: 'networkidle' });
      await pixelPage.evaluate(async () => { await window.__game.whenReady(); window.__game.pause(); window.__game.setShowcaseZoom(2); });
      const lane2x = await pixelPage.evaluate(() => { const layout = window.__game.getLayout(), canvas = document.querySelector('#game'), rect = canvas.getBoundingClientRect(); return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, logicalWidth: layout.width, logicalHeight: layout.height, zoom: layout.zoom, backingWidth: canvas.width, backingHeight: canvas.height }; });
      if (lane2x.logicalWidth !== 640 || lane2x.logicalHeight !== 160 || lane2x.zoom !== 2 || lane2x.backingWidth !== 1280 || lane2x.backingHeight !== 320) throw new Error(`Expected 640x160 logical lane at 2x with 1280x320 backing canvas, got ${JSON.stringify(lane2x)}`);
      if (lane2x.x < 0 || lane2x.y < 0 || lane2x.x + lane2x.width > 1280 || lane2x.y + lane2x.height > 640) throw new Error(`2x lane clip falls outside its viewport: ${JSON.stringify(lane2x)}`);
      delete lane2x.logicalWidth; delete lane2x.logicalHeight; delete lane2x.zoom; delete lane2x.backingWidth; delete lane2x.backingHeight;
      await pixelPage.evaluate(() => { window.__game.openPanel('home'); window.__game.debugShowcase('drop'); });
      await pixelPage.waitForFunction(() => document.querySelector('#management .px-legendary-toast:not([hidden]), #legendary-toast:not([hidden])'));
      await assertToastPixelSteps(pixelPage);
      for (const kind of ['skill', 'drop']) {
        await pixelPage.evaluate(value => { window.__game.debugShowcase(value); if (value === 'drop') document.querySelector('#notice').textContent = ''; }, kind);
        await pixelPage.evaluate(() => window.__game.debugShowcaseSeek(700));
        await pixelPage.screenshot({ path: `${out}/motion-${kind}-2x.png`, clip: lane2x });
      }
      await pixelPage.close();
    }
    await page.evaluate(() => { window.__game.openPanel('home'); window.__game.debugShowcase('drop'); });
    if (!reduced) {
      await page.waitForFunction(() => document.querySelector('#management .px-legendary-toast:not([hidden]), #legendary-toast:not([hidden])'));
      await assertToastPixelSteps(page);
    }
    let toastAge = 0;
    for (const [index, delay] of [0, 90, 180, 300, 550, 1800].entries()) {
      if (delay > toastAge) await page.waitForTimeout(delay - toastAge);
      toastAge = delay;
      const toast = page.locator('#management .px-legendary-toast');
      await toast.screenshot({ path: `${out}/${mode}-management-toast-${index + 1}.png` }).catch(async () => page.locator('#legendary-toast').screenshot({ path: `${out}/${mode}-management-toast-${index + 1}.png` }));
    }
    await page.evaluate(() => window.__game.openPanel(null));
    if (!reduced) {
      await page.evaluate(() => window.__game.debugShowcase('drop'));
      await page.evaluate(() => window.__game.debugShowcaseSeek(1300));
      await page.screenshot({ path: `${out}/motion-drop-card-hold.png`, clip: { x: lane.x, y: lane.y, width: lane.width, height: lane.height } });
      await page.evaluate(() => { localStorage.setItem('taskbar-legends:reduced-motion:v1', 'false'); window.__game.debugShowcase('drop'); });
      const secondWindow = await page.context().newPage();
      await secondWindow.goto(base, { waitUntil: 'networkidle' });
      await secondWindow.evaluate(() => localStorage.setItem('taskbar-legends:reduced-motion:v1', 'true'));
      await page.waitForFunction(() => document.body.dataset.reducedMotion === 'true' && document.querySelector('#legendary-toast').dataset.reducedMotion === 'true');
      const activeToastMotion = await page.locator('#legendary-toast').evaluate(el => el.ownerDocument.defaultView.getComputedStyle(el).animationName);
      if (activeToastMotion !== 'none') throw new Error(`Active toast did not stop after cross-window reduced-motion change: ${activeToastMotion}`);
      await secondWindow.close();
      await page.evaluate(() => { localStorage.removeItem('taskbar-legends:reduced-motion:v1'); window.__game.debugShowcase('skill'); window.__game.debugShowcaseSeek(180); window.__game.openPanel('settings'); });
      const reducedToggle = page.locator('#management [data-action="reduced-motion"]');
      await reducedToggle.waitFor({ state: 'visible' }); await reducedToggle.click();
      await page.waitForFunction(() => localStorage.getItem('taskbar-legends:reduced-motion:v1') === 'true');
      await page.evaluate(() => window.__game.openPanel(null));
      for (const [index, age] of [180, 900].entries()) {
        await page.evaluate(ms => window.__game.debugShowcaseSeek(ms), age);
        await page.screenshot({ path: `${out}/pref-skill-${String(index + 1).padStart(2, '0')}.png`, clip: { x: lane.x, y: lane.y, width: lane.width, height: lane.height } });
      }
      for (const slot of ['armor', 'charm']) {
        await page.evaluate(value => { window.__game.debugShowcase('drop', value); document.querySelector('#notice').textContent = ''; }, slot);
        await page.evaluate(() => window.__game.debugShowcaseSeek(700));
        await page.screenshot({ path: `${out}/motion-drop-${slot}.png`, clip: { x: lane.x, y: lane.y, width: lane.width, height: lane.height } });
      }
    }
    await context.close();
  }
  if (ffmpeg) {
    for (const kind of ['skill', 'drop']) await assertFile(`${out}/${kind}-sequence.png`);
  }
  for (const kind of ['skill', 'drop']) {
    const captures = await Promise.all(Array.from({ length: frames }, (_, index) => import('node:fs/promises').then(fs => fs.readFile(`${out}/reduced-${kind}-${String(index + 1).padStart(2, '0')}.png`))));
    if (captures.some(frame => !frame.equals(captures[0]))) throw new Error(`Reduced-motion ${kind} frames changed while the effect was active`);
  }
  const preferenceFrames = await Promise.all([1, 2].map(index => import('node:fs/promises').then(fs => fs.readFile(`${out}/pref-skill-${String(index).padStart(2, '0')}.png`))));
  if (!preferenceFrames[0].equals(preferenceFrames[1])) throw new Error('The in-game reduced-motion preference did not keep the active skill effect static');
  await Promise.all(['armor', 'charm'].map(slot => assertFile(`${out}/motion-drop-${slot}.png`)));
  await assertFile(`${out}/motion-drop-card-hold.png`);
} finally { await browser.close(); }
