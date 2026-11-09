// Measures how many leading samples the browser's AAC decoder leaves in ambient_loop.m4a compared with the OGG master,
// in Chromium and in Playwright WebKit. Run: npx tsx scripts/measure-aac-offset.ts [--write]
// --write stores the WebKit result in src/audio-manifest.json as m4aOffsetSamples (the M4A copy is only chosen by
// engines that cannot decode OGG, i.e. WebKit/Safari).
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';

const types: Record<string, string> = { '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.html': 'text/html' };
const server = createServer((request, response) => {
  const path = join('public/audio', (request.url ?? '/').split('?')[0]?.replace(/^\/+/, '') ?? '');
  if (!existsSync(path) || !path.startsWith('public/audio/')) { response.writeHead(request.url === '/' ? 200 : 404, { 'content-type': 'text/html' }); response.end('<!doctype html>'); return; }
  void readFile(path).then(body => { response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); response.end(body); });
});
await new Promise<void>(resolve => server.listen(4191, '127.0.0.1', resolve));
interface Decoded { ok: boolean; length?: number; rate?: number; head?: number[]; tail?: number[]; error?: string; canPlay: string }
async function decode(browser: Browser): Promise<Record<string, Decoded>> {
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:4191/');
  const result = await page.evaluate(async () => {
    const out: Record<string, Decoded> = {};
    const mime: Record<string, string> = { ogg: 'audio/ogg; codecs="vorbis"', m4a: 'audio/mp4; codecs="mp4a.40.2"', mp3: 'audio/mpeg' };
    for (const format of ['ogg', 'm4a', 'mp3']) {
      const context = new AudioContext({ sampleRate: 48000 }), canPlay = new Audio().canPlayType(mime[format] ?? '');
      try {
        const bytes = await (await fetch(`/ambient_loop.${format}`)).arrayBuffer();
        const buffer = await context.decodeAudioData(bytes), data = buffer.getChannelData(0);
        out[format] = { ok: true, canPlay, length: buffer.length, rate: buffer.sampleRate, head: Array.from(data.subarray(0, 8192)), tail: Array.from(data.subarray(Math.max(0, buffer.length - 4096))) };
      } catch (error) { out[format] = { ok: false, canPlay, error: String(error) }; }
      await context.close();
    }
    return out;
  });
  await page.close(); return result;
}
// Lag (in samples) that best aligns candidate onto reference: candidate[i + lag] ≈ reference[i].
function bestLag(reference: number[], candidate: number[], maxLag = 4096): { lag: number; error: number } {
  const window = 2048; let best = { lag: 0, error: Infinity };
  const energy = reference.slice(0, window).reduce((sum, value) => sum + value * value, 0) || 1;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let error = 0, count = 0;
    for (let i = 2048; i < 2048 + window; i += 1) { const c = candidate[i + lag]; const r = reference[i]; if (c === undefined || r === undefined) continue; error += (c - r) ** 2; count += 1; }
    if (count === window && error < best.error) best = { lag, error };
  }
  return { lag: best.lag, error: best.error / energy };
}
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => existsSync(path));
const report: Record<string, unknown> = {};
for (const [name, launch] of [['chromium', () => chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })], ['webkit', () => webkit.launch()]] as const) {
  const browser = await launch();
  try {
    const decoded = await decode(browser), entry: Record<string, unknown> = { version: browser.version() };
    for (const [format, value] of Object.entries(decoded)) entry[format] = { ok: value.ok, canPlayType: value.canPlay, length: value.length, error: value.error };
    // The OGG decode is the reference timeline; if this engine cannot decode OGG, use the other engine's OGG later.
    entry.raw = decoded; report[name] = entry;
  } finally { await browser.close(); }
}
server.close();
const reference = ((report.chromium as { raw: Record<string, Decoded> }).raw.ogg?.head) ?? [];
const summary: Record<string, unknown> = {};
for (const name of ['chromium', 'webkit']) {
  const entry = report[name] as Record<string, unknown> & { raw: Record<string, Decoded> }; const out: Record<string, unknown> = { version: entry.version };
  for (const format of ['ogg', 'm4a', 'mp3']) {
    const value = entry.raw[format];
    if (!value?.ok || !value.head) { out[format] = { decoded: false, canPlayType: value?.canPlay, error: value?.error }; continue; }
    const match = bestLag(reference, value.head);
    out[format] = { decoded: true, canPlayType: value.canPlay, length: value.length, offsetSamples: match.lag, residual: Number(match.error.toFixed(5)), lengthDelta: (value.length ?? 0) - 2_304_000 };
  }
  summary[name] = out;
}
console.log(JSON.stringify(summary, null, 2));
await writeFile('shots/aac-offset.json', JSON.stringify(summary, null, 2) + '\n');
if (process.argv.includes('--write')) {
  const manifest = JSON.parse(await readFile('src/audio-manifest.json', 'utf8')) as Record<string, unknown>;
  const webkitM4a = (summary.webkit as Record<string, { offsetSamples?: number }>).m4a;
  manifest.m4aOffsetSamples = webkitM4a?.offsetSamples ?? 0;
  manifest.m4aOffsetMeasurement = { method: 'scripts/measure-aac-offset.ts: decodeAudioData in Playwright Chromium + WebKit, channel 0 lag search against the OGG decode', summary };
  await writeFile('src/audio-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
