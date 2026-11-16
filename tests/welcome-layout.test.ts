import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ellipsize } from '../src/text-fit';
import { welcomeLayout, type Rect } from '../src/welcome-layout';

const inside = (outer: Rect, child: Rect): boolean => child.x >= outer.x && child.y >= outer.y && child.x + child.width <= outer.x + outer.width && child.y + child.height <= outer.y + outer.height;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const measure = (text: string): number => Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0)! > 0xffff ? 18 : 8), 0);

describe('welcome return layout and text fit', () => {
  it.each([480, 640, 960])('keeps welcome controls and content inside the %i source-pixel frame', width => {
    for (const slots of [4, 28]) {
      const layout = welcomeLayout(width, slots), world = (rect: Rect): Rect => ({ ...rect, x: rect.x + layout.panel.x });
      const bounds = { x: 0, y: 0, width, height: 488 };
      expect(inside(bounds, layout.panel)).toBe(true);
      const panelLocal = { x: 0, y: 0, width: layout.panel.width, height: layout.panel.height };
      for (const item of [layout.close, layout.capBar, layout.gold, layout.xp, layout.chest, layout.party, layout.collect]) expect(inside(panelLocal, item)).toBe(true);
      expect(overlaps(layout.gold, layout.xp)).toBe(false);
      expect(overlaps(layout.chest, layout.party)).toBe(false);
      expect(layout.heroes).toHaveLength(3);
      for (const tile of layout.heroes) expect(inside(panelLocal, tile)).toBe(true);
      for (let index = 1; index < layout.heroes.length; index += 1) expect(overlaps(layout.heroes[index - 1]!, layout.heroes[index]!)).toBe(false);
      const grid = layout.chestGrid, count = Math.max(4, slots), cells = Array.from({ length: count }, (_, index) => ({
        x: world({ x: grid.x + index % grid.perRow * grid.stride, y: grid.y + Math.floor(index / grid.perRow) * grid.stride, width: grid.size, height: grid.size }).x,
        y: grid.y + Math.floor(index / grid.perRow) * grid.stride, width: grid.size, height: grid.size,
      }));
      for (const cell of cells) expect(inside(bounds, cell)).toBe(true);
      for (let index = 1; index < cells.length; index += 1) expect(overlaps(cells[index - 1]!, cells[index]!)).toBe(false);
      const saveNote = world({ ...layout.saveNote, height: 16 });
      const collect = world(layout.collect);
      expect(overlaps(saveNote, collect)).toBe(false);
    }
  });

  it('switches cleanly between compact and wide geometry while preserving all 28 chest slots', () => {
    expect(welcomeLayout(640, 28).compact).toBe(true);
    expect(welcomeLayout(960, 28).compact).toBe(false);
    for (const width of [480, 640, 960]) {
      const grid = welcomeLayout(width, 28).chestGrid;
      expect(grid.perRow * 2).toBeGreaterThanOrEqual(28);
    }
  });

  it('bounds Unicode ellipsizing for long names and narrow or empty widths', () => {
    for (const source of ['A'.repeat(100_000), '長い名前🐉'.repeat(500), '🧝🏽‍♀️'.repeat(100)]) {
      const fitted = ellipsize(source, 96, measure);
      expect(fitted.endsWith('…')).toBe(true);
      expect(measure(fitted)).toBeLessThanOrEqual(96);
      expect(fitted).not.toMatch(/[\uD800-\uDBFF]$/u);
      expect(fitted).not.toMatch(/^[\uDC00-\uDFFF]/u);
    }
    expect(ellipsize('name', 0, measure)).toBe('');
    expect(ellipsize('name', -1, measure)).toBe('');
    expect(ellipsize('name', 3, measure)).toBe('');
    expect(ellipsize('ok', 16, measure)).toBe('ok');
  });

  it('keeps active welcome labels in proper UTF-8 and both reveal name paths use bounded truncation', () => {
    const source = readFileSync(new URL('../src/pixel-ui.ts', import.meta.url), 'utf8');
    expect(source).toContain('Rewards capped · max');
    expect(source).toContain('XP · EACH PARTY HERO');
    expect(source).toContain('PARTY · FARMED');
    expect(source).toContain('· Again needs');
    expect(source).not.toContain('â€¦');
    expect(source).not.toContain('Â·');
  });
});
