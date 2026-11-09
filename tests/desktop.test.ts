import { describe, expect, it } from 'vitest';
import { DesktopController } from '../src/platform/desktop/controller';
import type { DesktopPort } from '../src/platform/desktop/controller';
import { cursorHits, dockRect, monitorSchema } from '../src/platform/desktop/math';
import type { DesktopMonitor, PhysicalPoint, PhysicalRect } from '../src/platform/desktop/math';

function monitor(scaleFactor = 1): DesktopMonitor {
  return { key: 'secondary', scaleFactor, workArea: { x: -1920, y: -100, width: 1920, height: 1040 } };
}
describe('desktop physical/logical boundary math', () => {
  for (const scale of [1, 1.25, 1.5, 2]) {
    it(`docks logical160/488 upward without moving screen-space feet at ${scale} DPI`, () => {
      const m = monitor(scale), closed = dockRect(m, 160), open = dockRect(m, 488);
      expect(closed.height).toBe(Math.round(160 * scale)); expect(open.height).toBe(Math.round(488 * scale));
      expect(closed.width).toBe(1920); expect(closed.x).toBe(-1920);
      expect(open.y + open.height).toBe(closed.y + closed.height);
      expect(open.y).toBe(closed.y - (open.height - closed.height));
      // Native-pixel canvas remains bottom-anchored inside the logical host.
      expect(closed.y + closed.height - 24).toBe(open.y + open.height - 24);
    });
  }
  for (const workArea of [
    { x: 0, y: 0, width: 1920, height: 1040 }, // bottom taskbar
    { x: 0, y: 40, width: 1920, height: 1040 }, // top taskbar
    { x: 60, y: 0, width: 1860, height: 1080 }, // left taskbar
    { x: 0, y: 0, width: 1860, height: 1080 }, // right taskbar
  ]) {
    it(`never covers an excluded taskbar (${JSON.stringify(workArea)})`, () => {
      const rect = dockRect({ key: 'display', scaleFactor: 1, workArea }, 160);
      expect(rect.x).toBe(workArea.x); expect(rect.width).toBe(workArea.width);
      expect(rect.y + rect.height).toBe(workArea.y + workArea.height);
    });
  }
  it('clamps a short work area and rejects malformed monitor data', () => {
    expect(dockRect({ key: 'tiny', scaleFactor: 2, workArea: { x: 0, y: 10, width: 640, height: 400 } }, 488)).toEqual({ x: 0, y: 10, width: 640, height: 400 });
    expect(() => monitorSchema.parse({ ...monitor(), scaleFactor: 0 })).toThrow();
    expect(() => dockRect(monitor(), NaN)).toThrow();
  });
  it('hit tests CSS islands in physical screen space with negative origins, padding and exclusive bounds', () => {
    const args = { origin: { x: -1920, y: 800 }, scaleFactor: 1.25, regions: [{ x: 8, y: 102.4, width: 280, height: 51.2 }] };
    expect(cursorHits({ ...args, cursor: { x: -1910, y: 928 } })).toBe(true);
    expect(cursorHits({ ...args, cursor: { x: -1560, y: 928 } })).toBe(false);
    expect(cursorHits({ ...args, cursor: { x: -1910, y: 992 } })).toBe(false);
    expect(cursorHits({ ...args, cursor: { x: -1910, y: 927 } })).toBe(false);
    expect(cursorHits({ ...args, cursor: { x: -1910, y: 928 }, regions: [] })).toBe(false);
    expect(cursorHits({ ...args, cursor: { x: 0, y: 0 }, scaleFactor: NaN })).toBe(false);
  });
  it('does not capture the battlefield or transparent effects; captures the open panel', () => {
    const base = { origin: { x: 0, y: 0 }, scaleFactor: 1, cursor: { x: 600, y: 120 } };
    const islands = [{ x: 8, y: 88, width: 280, height: 64 }, { x: 992, y: 88, width: 280, height: 64 }];
    expect(cursorHits({ ...base, regions: islands })).toBe(false);
    expect(cursorHits({ ...base, cursor: { x: 12, y: 12 }, regions: islands })).toBe(false);
    expect(cursorHits({ ...base, regions: [...islands, { x: 552, y: 0, width: 720, height: 400 }] })).toBe(true);
  });
});

class MemoryDesktop implements DesktopPort {
  display = monitor();
  rect: PhysicalRect = { x: 0, y: 0, width: 1280, height: 160 };
  pointer: PhysicalPoint = { x: 0, y: 0 };
  sizeCalls = 0;
  ignores: boolean[] = [];
  monitor(): Promise<DesktopMonitor> { return Promise.resolve(this.display); }
  frame(): Promise<{ origin: PhysicalPoint; scaleFactor: number }> { return Promise.resolve({ origin: { x: this.rect.x, y: this.rect.y }, scaleFactor: this.display.scaleFactor }); }
  bounds(): Promise<PhysicalRect> { return Promise.resolve({ ...this.rect }); }
  cursor(): Promise<PhysicalPoint> { return Promise.resolve(this.pointer); }
  setBounds(rect: PhysicalRect): Promise<void> { this.rect = rect; this.sizeCalls += 1; return Promise.resolve(); }
  ignoreCursor(ignore: boolean): Promise<void> { this.ignores.push(ignore); return Promise.resolve(); }
}
describe('native controller invariants (in-memory OS boundary, not native proof)', () => {
  it('resizes once per panel edge, never for tab/animation polling; corrects external movement', async () => {
    const port = new MemoryDesktop(), controller = new DesktopController(port);
    await controller.dock(160); for (let i = 0; i < 20; i += 1) await controller.dock(160);
    expect(port.sizeCalls).toBe(1);
    await controller.dock(488); await controller.dock(488); expect(port.sizeCalls).toBe(2);
    await controller.dock(160); expect(port.sizeCalls).toBe(3);
    port.rect.x += 50; await controller.dock(160); expect(port.sizeCalls).toBe(4); expect(port.rect.x).toBe(-1920);
    port.display = { ...monitor(1.5), workArea: { x: 0, y: 0, width: 2560, height: 1400 } };
    await controller.dock(160); expect(port.rect).toEqual({ x: 0, y: 1160, width: 2560, height: 240 });
  });
  it('toggles native ignore only at hit-boundary changes and propagates OS failures', async () => {
    const port = new MemoryDesktop(), controller = new DesktopController(port);
    port.rect = { x: 0, y: 0, width: 1280, height: 160 };
    const regions = [{ x: 8, y: 88, width: 280, height: 64 }];
    await controller.hitTest(regions); await controller.hitTest(regions); expect(port.ignores).toEqual([true]);
    port.pointer = { x: 12, y: 100 }; await controller.hitTest(regions); await controller.hitTest(regions); expect(port.ignores).toEqual([true, false]);
    port.pointer = { x: 600, y: 100 }; await controller.hitTest(regions); expect(port.ignores).toEqual([true, false, true]);
    port.cursor = () => Promise.reject(new Error('OS unavailable'));
    await expect(controller.hitTest(regions)).rejects.toThrow('OS unavailable');
  });
});
