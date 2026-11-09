import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { preview } from 'vite';
import '../src/debug';
import '../src/platform/desktop/tauri';
import { CONFIG } from '../src/config';
interface MockNative {
  rect: { x: number; y: number; width: number; height: number };
  cursor: { x: number; y: number };
  sizeCalls: number;
  ignoreCalls: boolean[];
  visible: boolean;
  failCursor: boolean;
  exits: { command: string; saved: boolean }[];
  listeners: { event: string; handler: number }[];
}
declare global { interface Window { __nativeMock: MockNative; __emitMock(event: string): void } }
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
await mkdir('shots', { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4176, strictPort: true } });
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const results = [];
try {
  for (const { scale, mode } of [
    { scale: 1, mode: 'overlay' }, { scale: 1.25, mode: 'overlay' }, { scale: 1.5, mode: 'overlay' },
    { scale: 2, mode: 'overlay' }, { scale: 2, mode: 'window' },
  ]) {
    const context = await browser.newContext({ viewport: { width: mode === 'window' ? 800 : Math.round(1920 / scale), height: mode === 'window' ? 488 : 160 }, deviceScaleFactor: scale });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.exposeFunction('__resizeMockNative', async (size: { width: number; height: number }) => {
      await page.setViewportSize({ width: Math.round(size.width / scale), height: Math.round(size.height / scale) });
    });
    const initializeNativeBoundary = ({ scale, mode, saveKey }: { scale: number; mode: string; saveKey: string }): void => {
      const state: MockNative = { rect: { x: 0, y: 0, width: mode === 'window' ? 800 * scale : 1920, height: Math.round((mode === 'window' ? 488 : 160) * scale) }, cursor: { x: 500, y: 500 }, sizeCalls: 0, ignoreCalls: [], visible: false, failCursor: false, exits: [], listeners: [] };
      const monitor = { name: 'emulated-display', position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } }, scaleFactor: scale };
      let callback = 0;
      const host = Object.assign(window, { __nativeMock: state, isTauri: true });
      const callbacks = new Map<number, (event: unknown) => void>();
      host.__emitMock = (event: string) => { for (const listener of state.listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id: listener.handler, payload: null }); };
      Object.assign(window, { __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: (fn: (event: unknown) => void) => { const id = ++callback; callbacks.set(id, fn); return id; }, unregisterCallback: () => undefined,
        invoke: async (command: string, raw: unknown) => {
          const args: unknown = JSON.parse(JSON.stringify(raw ?? {}));
          switch (command) {
            case 'plugin:event|listen': {
              if (!args || typeof args !== 'object' || !('event' in args) || typeof args.event !== 'string' || !('handler' in args) || typeof args.handler !== 'number') throw new Error('Invalid listen IPC');
              state.listeners.push({ event: args.event, handler: args.handler }); return ++callback;
            }
            case 'shell_mode': return mode;
            case 'quit_app': case 'relaunch_app': state.exits.push({ command, saved: localStorage.getItem(saveKey) !== null }); return null;
            case 'plugin:event|unlisten': return null;
            case 'plugin:window|current_monitor': case 'plugin:window|primary_monitor': return monitor;
            case 'plugin:window|available_monitors': return [monitor];
            case 'plugin:window|inner_position': return { x: state.rect.x, y: state.rect.y };
            case 'plugin:window|inner_size': return { width: state.rect.width, height: state.rect.height };
            case 'plugin:window|scale_factor': return scale;
            case 'plugin:window|cursor_position': if (state.failCursor) throw new Error('emulated cursor API failure'); return state.cursor;
            case 'set_overlay_bounds': {
              if (!args || typeof args !== 'object' || !('bounds' in args)) throw new Error('Malformed bounds IPC');
              const rect = args.bounds;
              if (!rect || typeof rect !== 'object' || !('x' in rect) || typeof rect.x !== 'number' || !('y' in rect) || typeof rect.y !== 'number' || !('width' in rect) || typeof rect.width !== 'number' || !('height' in rect) || typeof rect.height !== 'number') throw new Error('Invalid physical bounds');
              const resized = state.rect.width !== rect.width || state.rect.height !== rect.height;
              state.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
              if (resized) {
                state.sizeCalls += 1;
                const fn: unknown = Reflect.get(host, '__resizeMockNative');
                if (typeof fn !== 'function') throw new Error('No resize boundary');
                await fn({ width: rect.width, height: rect.height });
              }
              return null;
            }
            case 'plugin:window|set_ignore_cursor_events':
              if (!args || typeof args !== 'object' || !('value' in args) || typeof args.value !== 'boolean') throw new Error('Invalid ignore IPC');
              state.ignoreCalls.push(args.value); return null;
            case 'plugin:window|show': state.visible = true; return null;
            case 'plugin:window|hide': case 'plugin:window|close': state.visible = false; return null;
            default: throw new Error(`Unexpected native IPC ${command}`);
          }
        },
      } });
    };
    // tsx preserves function names with a helper; serialized browser code needs it too.
    await page.addInitScript({ content: `globalThis.__name = fn => fn; (${initializeNativeBoundary.toString()})(${JSON.stringify({ scale, mode, saveKey: CONFIG.runtime.saveKey })});` });
    await page.goto(`http://127.0.0.1:4176${process.env.VITE_BASE_PATH || '/'}?shot`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__shell?.getDiagnostics().active || window.__shell?.getDiagnostics().errors.length || document.getElementById('notice')?.textContent?.includes('Desktop shell failed'), null, { timeout: 5000 }).catch(async error => { throw new Error(`${String(error)} ${JSON.stringify(await page.evaluate(() => ({ shell: window.__shell?.getDiagnostics(), notice: document.getElementById('notice')?.textContent })))}, pageErrors=${errors.join(';')}`); });
    if (!await page.evaluate(() => window.__shell?.getDiagnostics().active)) throw new Error(JSON.stringify(await page.evaluate(() => ({ shell: window.__shell?.getDiagnostics(), notice: document.getElementById('notice')?.textContent }))) + errors.join(';'));
    await page.evaluate(() => { window.__game.pause(); window.__game.setSeed(1); window.__game.step(30); });
    const initial = await page.evaluate(() => ({ mock: window.__nativeMock, layout: window.__game.getLayout(), regions: window.__game.getHitRegions() }));
    if (mode === 'window') {
      await page.evaluate(() => window.__game.openPanel('heroes'));
      await page.waitForFunction(() => window.__game.getLayout().height === 488);
      const fallback = await page.evaluate(() => ({ mock: window.__nativeMock, shell: window.__shell?.getDiagnostics(), background: getComputedStyle(document.body).backgroundColor }));
      if (fallback.shell?.mode !== 'window' || fallback.shell.hitTests !== 0 || fallback.mock.sizeCalls !== 0 || JSON.stringify(fallback.mock.ignoreCalls) !== '[false]' || fallback.background !== 'rgb(23, 33, 45)' || errors.length) throw new Error(`Opaque fallback failed: ${JSON.stringify({ fallback, errors })}`);
      await page.screenshot({ path: 'shots/m2-mac-opaque-retina.png' });
      results.push({ scale, mode, proof: 'Emulated IPC only, not a real Mac compositor', fallback, errors });
      await context.close();
      continue;
    }
    if (initial.mock.rect.height !== Math.round(160 * scale) || initial.layout.height !== 160 || initial.mock.rect.y + initial.mock.rect.height !== 1040) throw new Error('Closed docking/DPI mismatch');
    await page.evaluate(() => {
      const region = window.__game.getHitRegions()[0]; if (!region) throw new Error('Missing HUD region');
      const rect = window.__nativeMock.rect;
      window.__nativeMock.cursor = { x: rect.x + Math.round((region.x + 2) * devicePixelRatio), y: rect.y + Math.round((region.y + 2) * devicePixelRatio) };
    });
    await page.waitForFunction(() => window.__shell?.getDiagnostics().ignoring === false);
    await page.evaluate(() => { const rect = window.__nativeMock.rect; window.__nativeMock.cursor = { x: rect.x + rect.width / 2, y: rect.y + rect.height - 30 }; });
    await page.waitForFunction(() => window.__shell?.getDiagnostics().ignoring === true);
    if (scale === 1.25) await page.screenshot({ path: 'shots/m2-logical-host-dpi125.png', omitBackground: true });
    if (scale === 2) await page.screenshot({ path: 'shots/m2-mac-retina-overlay.png', omitBackground: true });
    await page.evaluate(() => window.__game.openPanel('heroes'));
    await page.waitForFunction(() => window.__nativeMock.rect.height === Math.round(488 * devicePixelRatio) && window.__shell?.getDiagnostics().logicalHeight === 488);
    const open = await page.evaluate(() => ({ mock: window.__nativeMock, layout: window.__game.getLayout(), regions: window.__game.getHitRegions() }));
    if (open.mock.sizeCalls !== initial.mock.sizeCalls + 1 || open.mock.rect.y + open.mock.rect.height !== 1040 || open.regions.length !== 4 || !open.regions.some(region => region.id === 'quit')) throw new Error('Expanded native resize/regions mismatch');
    await page.evaluate(() => window.__game.openPanel('gear'));
    await page.waitForFunction(() => window.__shell && window.__shell.getDiagnostics().hitTests > 10);
    if (await page.evaluate(() => window.__nativeMock.sizeCalls) !== open.mock.sizeCalls) throw new Error('Tab switch resized host');
    if (scale === 1.25) await page.screenshot({ path: 'shots/m2-logical-panel-dpi125.png', omitBackground: true });
    await page.evaluate(() => window.__game.openPanel(null));
    await page.waitForFunction(() => window.__nativeMock.rect.height === Math.round(160 * devicePixelRatio) && window.__shell?.getDiagnostics().logicalHeight === 160);
    if (await page.evaluate(() => window.__nativeMock.sizeCalls) !== initial.mock.sizeCalls + 2) throw new Error('Close resized more than once');
    await page.evaluate(() => { window.__nativeMock.rect.x += 50; });
    await page.waitForFunction(() => window.__nativeMock.rect.x === 0);
    // Save-then-exit: HUD Quit button, tray/menu-bar Quit, and the Opaque-window relaunch.
    const exitPath = scale === 1 ? 'hud' : scale === 1.25 ? 'tray-quit' : 'tray-relaunch';
    if (scale <= 1.5) {
      await page.evaluate(key => { localStorage.removeItem(key); }, CONFIG.runtime.saveKey);
      if (exitPath === 'hud') {
        if (!initial.regions.some(region => region.id === 'quit')) throw new Error('Quit button missing from hit regions');
        await page.screenshot({ path: 'shots/m2-hud-quit-1920.png', omitBackground: true });
        await page.click('[data-control="quit"]', { force: true });
      } else await page.evaluate(event => { window.__emitMock(event); }, exitPath === 'tray-quit' ? 'shell://quit' : 'shell://relaunch');
      await page.waitForFunction(() => window.__nativeMock.exits.length > 0);
      const exits = await page.evaluate(() => window.__nativeMock.exits);
      const expected = exitPath === 'tray-relaunch' ? 'relaunch_app' : 'quit_app';
      if (exits.length !== 1 || exits[0]?.command !== expected || !exits[0].saved) throw new Error(`Save-then-exit failed for ${exitPath}: ${JSON.stringify(exits)}`);
    }
    await page.evaluate(() => { window.__nativeMock.failCursor = true; });
    await page.waitForFunction(() => window.__shell?.getDiagnostics().errors.length && !window.__nativeMock.visible);
    const failure = await page.evaluate(() => window.__shell?.getDiagnostics());
    if (errors.length) throw new Error(errors.join('\n'));
    results.push({ scale, mode, exitPath: scale <= 1.5 ? exitPath : null, proof: 'Browser with emulated native IPC only; not real Windows click-through proof', initial, open, failure, errors });
    await context.close();
  }
  await writeFile('shots/m2-adapter-checks.json', JSON.stringify(results, null, 2));
  process.stdout.write(JSON.stringify({ pass: true, scales: results.map(result => result.scale), nativeProof: false }, null, 2) + '\n');
} finally { await browser.close(); await new Promise<void>(resolve => server.httpServer.close(() => resolve())); }
