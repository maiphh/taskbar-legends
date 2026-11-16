/* global window, document, CanvasRenderingContext2D */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import process from 'node:process';
import { chromium } from 'playwright';

const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.addInitScript(() => {
    window.__fontDraws = [];
    const drawText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__fontDraws.push({ text: String(text), font: this.font, width: this.measureText(String(text)).width });
      return drawText.call(this, text, ...args);
    };
  });
  await page.goto(process.env.FONT_CHECK_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => Boolean(window.__game));
  await page.evaluate(() => window.__game.whenReady());
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__game.openPanel('heroes'));
  await page.waitForSelector('.campaign-status');
  await page.locator('nav button[data-tab="recruit"]').click();
  await page.locator('[data-action="pull-one"]').click();
  await page.waitForFunction(() => window.__game.getManagementReveal()?.done);

  const result = await page.evaluate(() => ({ draws: window.__fontDraws, fonts: [...document.fonts].map(face => [face.family, face.weight, face.status]), accentCoverage: document.fonts.check('600 12px GameSans', 'Tiếng Việt · Русский') }));
  const boldDraw = result.draws.find(draw => draw.font.startsWith('600 12px GameSans'));
  const regularDraw = result.draws.find(draw => /(?:^| )12px GameSans/.test(draw.font) && !draw.font.startsWith('600 '));
  assert.ok(boldDraw, 'Canvas fillText must receive the requested 600 12px GameSans face after raster resize');
  assert.ok(regularDraw, 'Canvas fillText must receive the requested normal 12px GameSans face after raster resize');
  assert.ok(result.fonts.some(([family, weight, status]) => family === 'GameSans' && weight === '400' && status === 'loaded'));
  assert.ok(result.fonts.some(([family, weight, status]) => family === 'GameSans' && weight === '600' && status === 'loaded'));
  assert.ok(result.accentCoverage, 'The semibold face must cover the Vietnamese and Cyrillic specimen');
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/font-canvas-draw-check.png' });
  process.stdout.write(`${JSON.stringify({ boldDraw, regularDraw, fontFaces: result.fonts, screenshot: 'artifacts/font-canvas-draw-check.png' }, null, 2)}\n`);
} finally {
  await browser.close();
}
