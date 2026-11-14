import { describe, expect, it } from 'vitest';
import { COMPACT_DEFAULTS, acceptsGeometryPoll, clientRectToFrameRect, clientWorkArea, constrainCompactRect, geometryGenerationCurrent, gestureGeneration, normalizedCompactPrefs, parseCompactPrefs, restoreCompactGeometry, settleClientGeometry, snapCompactBottom } from '../src/platform/desktop/compact-geometry';
import type { DesktopMonitor } from '../src/platform/desktop/math';

function monitor(key: string, x: number, y: number, width: number, height: number, scaleFactor = 1): DesktopMonitor {
  return { key, scaleFactor, workArea: { x, y, width, height } };
}
describe('compact placement geometry', () => {
  it('uses safe defaults for missing/corrupt preferences and stores initial source dimensions', () => {
    expect(parseCompactPrefs(null)).toEqual(COMPACT_DEFAULTS);
    expect(parseCompactPrefs({ ...COMPACT_DEFAULTS, zoom: 3 })).toEqual(COMPACT_DEFAULTS);
    expect(restoreCompactGeometry(COMPACT_DEFAULTS, monitor('left', -1920, 40, 1920, 1040)).rect).toEqual({ x: -640, y: 920, width: 640, height: 160 });
  });
  it('restores normalized anchors with negative origins and snapped bottom placement', () => {
    const work = monitor('neg', -1280, -100, 1280, 900, 1.5);
    const prefs = { ...COMPACT_DEFAULTS, zoom: 2 as const, anchorX: 0.5, anchorY: 0.25 };
    expect(restoreCompactGeometry(prefs, work).rect).toEqual({ x: -1280, y: 45, width: 1280, height: 320 });
    const snapped = { ...prefs, placement: 'snapped' as const, snapEdge: 'bottom' as const };
    expect(restoreCompactGeometry(snapped, work).rect.y).toBe(480);
  });
  it('clamps saved source sizes to available work areas and preserves reachable controls on small screens', () => {
    const tiny = monitor('tiny', 0, 0, 360, 120, 2);
    const geometry = restoreCompactGeometry({ ...COMPACT_DEFAULTS, sourceWidth: 1280, sourceHeight: 256, zoom: 2 }, tiny);
    expect(geometry.rect).toEqual({ x: 0, y: 0, width: 360, height: 120 });
    expect(geometry.constrained).toBe(true);
    expect(geometry.sourceWidth).toBe(180);
  });
  it('keeps user bounds through ordinary polls and clamps only when the work area changes', () => {
    const first = monitor('one', 0, 0, 1920, 1080, 1.25), moved = monitor('one', 0, 0, 1000, 700, 1.5);
    const userRect = { x: 800, y: 510, width: 640, height: 160 };
    expect(constrainCompactRect(userRect, first)).toEqual(userRect);
    expect(constrainCompactRect(userRect, moved)).toEqual({ x: 360, y: 510, width: 640, height: 160 });
  });
  it('snaps only settled gestures and rejects stale monitor queries after a newer gesture', () => {
    const m = monitor('main', 100, 200, 1200, 800, 2), rect = { x: 250, y: 830, width: 640, height: 160 };
    const moving = normalizedCompactPrefs(COMPACT_DEFAULTS, rect, m, 'moving');
    expect(moving.placement).toBe('free');
    expect(normalizedCompactPrefs(COMPACT_DEFAULTS, rect, m, 'idle')).toMatchObject({ placement: 'snapped', snapEdge: 'bottom', anchorY: 1 });
    expect(snapCompactBottom(rect, m)).toMatchObject({ x: rect.x, y: 840, width: rect.width, height: rect.height });
    const g1 = gestureGeneration(2, 'moving'), g2 = gestureGeneration(g1.generation, 'resizing');
    expect(acceptsGeometryPoll(g1.generation, 2, g2.state)).toBe(false);
    expect(acceptsGeometryPoll(g2.generation, g2.generation, 'idle')).toBe(true);
    expect(snapCompactBottom(rect, m).y).toBe(840);
  });
  it('normalizes anchor after monitor removal and keeps values finite at mixed DPI', () => {
    const monitorLeft = monitor('removed', -2560, 0, 2560, 1400, 1.25), fallback = monitor('fallback', 0, 0, 1366, 768, 1.5);
    const prefs = { ...COMPACT_DEFAULTS, monitorKey: 'removed', anchorX: 1, anchorY: 1 };
    expect(restoreCompactGeometry(prefs, fallback, fallback).rect).toEqual({ x: 726, y: 608, width: 640, height: 160 });
    expect(normalizedCompactPrefs(prefs, constrainCompactRect({ x: -5000, y: 1200, width: 640, height: 160 }, monitorLeft), monitorLeft).anchorX).toBe(0);
  });
  it('keeps opaque decorated frames inside the work area while preserving physical client size across DPI', () => {
    const decorated = monitor('opaque', 0, 0, 1920, 1080, 1.5), insets = { left: 8, top: 31, right: 8, bottom: 8 };
    const clientMonitor = clientWorkArea(decorated, insets);
    const client = restoreCompactGeometry({ ...COMPACT_DEFAULTS, anchorX: 1, anchorY: 1 }, clientMonitor).rect;
    const frame = clientRectToFrameRect(client, insets);
    expect(client.width).toBe(640);
    expect(frame.x).toBeGreaterThanOrEqual(decorated.workArea.x);
    expect(frame.y).toBeGreaterThanOrEqual(decorated.workArea.y);
    expect(frame.x + frame.width).toBeLessThanOrEqual(decorated.workArea.x + decorated.workArea.width);
    expect(frame.y + frame.height).toBeLessThanOrEqual(decorated.workArea.y + decorated.workArea.height);
    expect(restoreCompactGeometry({ ...COMPACT_DEFAULTS, anchorX: 1, anchorY: 1 }, clientMonitor).rect.width).toBe(640);
    const dpi1 = monitor('same', 0, 0, 1920, 1080, 1), dpi15 = monitor('same', 0, 0, 1920, 1080, 1.5);
    const geometry1 = restoreCompactGeometry(COMPACT_DEFAULTS, clientWorkArea(dpi1, insets));
    const geometry15 = restoreCompactGeometry(COMPACT_DEFAULTS, clientWorkArea(dpi15, insets));
    expect(geometry15.rect.width).toBe(geometry1.rect.width);
    expect(geometry15.cssWidth).toBeCloseTo(640 / 1.5);
    expect(COMPACT_DEFAULTS.sourceWidth).toBe(640);
  });
  it('rejects an old delayed monitor query after a newer move finishes', async () => {
    let generation = 1, applied = false, complete!: (value: string) => void;
    const observed = generation, delayed = new Promise<string>(resolve => { complete = resolve; });
    const result = delayed.then(value => { if (!geometryGenerationCurrent(generation, observed)) return false; applied = value === 'old-monitor'; return true; });
    generation += 1; complete('old-monitor');
    expect(await result).toBe(false);
    expect(applied).toBe(false);
  });
  it('preserves preferred 640px source width through a small-display move but accepts an explicit user resize', () => {
    const small = monitor('small', 0, 0, 500, 700, 1), client = { x: 0, y: 400, width: 500, height: 160 };
    expect(normalizedCompactPrefs(COMPACT_DEFAULTS, client, small, 'moving').sourceWidth).toBe(640);
    expect(normalizedCompactPrefs(COMPACT_DEFAULTS, client, small, 'idle').sourceWidth).toBe(640);
    expect(normalizedCompactPrefs(COMPACT_DEFAULTS, client, small, 'resizing').sourceWidth).toBe(500);
  });
  it('applies legal source limits after settled resizes without changing the free anchor', () => {
    const large = monitor('large', 0, 0, 3000, 1400, 1);
    const tooSmall = settleClientGeometry(COMPACT_DEFAULTS, { x: 100, y: 200, width: 400, height: 160 }, large, 'resizing');
    expect(tooSmall.rect).toMatchObject({ x: 100, y: 200, width: 480, height: 160 });
    const tooWide = settleClientGeometry(COMPACT_DEFAULTS, { x: 100, y: 200, width: 1500, height: 160 }, large, 'resizing');
    expect(tooWide.rect).toMatchObject({ x: 100, y: 200, width: 1280, height: 160 });
    expect(tooWide.prefs.sourceWidth).toBe(1280);
  });
  it('applies a bottom snap on settle, persists it, and does not drift on repeated settle events', () => {
    const work = monitor('snap', 0, 0, 1280, 900, 1);
    const nearBottom = { x: 300, y: 730, width: 640, height: 160 };
    const first = settleClientGeometry(COMPACT_DEFAULTS, nearBottom, work, 'moving');
    expect(first.rect.y).toBe(740);
    expect(first.prefs).toMatchObject({ placement: 'snapped', snapEdge: 'bottom', anchorY: 1 });
    const repeat = settleClientGeometry(first.prefs, first.rect, work, 'moving');
    expect(repeat.rect).toEqual(first.rect);
    expect(repeat.prefs).toMatchObject({ placement: 'snapped', snapEdge: 'bottom', anchorY: 1 });
  });
});
