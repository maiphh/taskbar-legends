import { z } from 'zod';
import { monitorSchema } from './math';
import type { DesktopMonitor, PhysicalPoint, PhysicalRect } from './math';

const fraction = z.number().finite().min(0).max(1);
const prefsSchema = z.object({
  version: z.literal(1), sourceWidth: z.number().int().min(480).max(1280), sourceHeight: z.number().int().min(160).max(256),
  zoom: z.union([z.literal(1), z.literal(2)]), placement: z.enum(['free', 'snapped']), snapEdge: z.literal('bottom').optional(),
  monitorKey: z.string().optional(), anchorX: fraction, anchorY: fraction,
}).strict();
export type CompactPrefs = z.infer<typeof prefsSchema>;
export type GestureState = 'idle' | 'moving' | 'resizing';
export interface CompactGeometry { rect: PhysicalRect; sourceWidth: number; sourceHeight: number; cssWidth: number; cssHeight: number; constrained: boolean }
export interface FrameInsets { left: number; top: number; right: number; bottom: number }
export const COMPACT_DEFAULTS: CompactPrefs = Object.freeze({ version: 1, sourceWidth: 640, sourceHeight: 160, zoom: 1, placement: 'free', monitorKey: undefined, anchorX: 1, anchorY: 1 });
export const SNAP_THRESHOLD_LOGICAL = 12;

export function parseCompactPrefs(value: unknown): CompactPrefs {
  const parsed = prefsSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...COMPACT_DEFAULTS };
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function physicalSize(prefs: CompactPrefs, work: PhysicalRect): { width: number; height: number; sourceWidth: number; sourceHeight: number } {
  const requestedWidth = Math.round(prefs.sourceWidth * prefs.zoom), requestedHeight = Math.round(prefs.sourceHeight * prefs.zoom);
  const width = Math.max(1, Math.min(Math.floor(work.width), requestedWidth));
  const height = Math.max(1, Math.min(Math.floor(work.height), requestedHeight));
  return { width, height, sourceWidth: Math.max(1, Math.floor(width / prefs.zoom)), sourceHeight: Math.max(1, Math.floor(height / prefs.zoom)) };
}
/** Resolve a normalized saved anchor against the chosen monitor's physical work area. */
export function restoreCompactGeometry(prefsInput: CompactPrefs, monitorInput: DesktopMonitor, fallback?: DesktopMonitor): CompactGeometry {
  const prefs = prefsSchema.parse(prefsInput), requestedMonitor = monitorSchema.parse(monitorInput);
  const monitor = prefs.monitorKey && prefs.monitorKey !== requestedMonitor.key && fallback ? monitorSchema.parse(fallback) : requestedMonitor;
  const work = monitor.workArea, size = physicalSize(prefs, work), maxX = Math.max(0, work.width - size.width), maxY = Math.max(0, work.height - size.height);
  let x = Math.round(work.x + prefs.anchorX * maxX), y = Math.round(work.y + prefs.anchorY * maxY);
  if (prefs.placement === 'snapped' && prefs.snapEdge === 'bottom') y = Math.round(work.y + work.height - size.height);
  x = clamp(x, Math.ceil(work.x), Math.floor(work.x + maxX)); y = clamp(y, Math.ceil(work.y), Math.floor(work.y + maxY));
  return { rect: { x, y, width: size.width, height: size.height }, sourceWidth: size.sourceWidth, sourceHeight: size.sourceHeight,
    cssWidth: size.width / monitor.scaleFactor, cssHeight: size.height / monitor.scaleFactor,
    constrained: size.width !== prefs.sourceWidth * prefs.zoom || size.height !== prefs.sourceHeight * prefs.zoom };
}
/** Recompute a saved anchor after a DPI/work-area change and clamp to the same monitor. */
export function constrainCompactRect(rectInput: PhysicalRect, monitorInput: DesktopMonitor): PhysicalRect {
  const rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() }).parse(rectInput);
  const monitor = monitorSchema.parse(monitorInput), work = monitor.workArea;
  const width = Math.min(rect.width, Math.floor(work.width)), height = Math.min(rect.height, Math.floor(work.height));
  return { x: clamp(rect.x, Math.ceil(work.x), Math.floor(work.x + work.width - width)), y: clamp(rect.y, Math.ceil(work.y), Math.floor(work.y + work.height - height)), width, height };
}
export function normalizedCompactPrefs(prefsInput: CompactPrefs, rectInput: PhysicalRect, monitorInput: DesktopMonitor, gesture: GestureState = 'idle'): CompactPrefs {
  const prefs = prefsSchema.parse(prefsInput), rect = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive() }).parse(rectInput);
  const monitor = monitorSchema.parse(monitorInput), work = monitor.workArea;
  const maxX = Math.max(0, work.width - rect.width), maxY = Math.max(0, work.height - rect.height);
  const areaLimited = work.width < 480 * prefs.zoom || work.height < 160 * prefs.zoom;
  const next = { ...prefs, ...(gesture === 'resizing' && !areaLimited ? { sourceWidth: Math.round(rect.width / prefs.zoom), sourceHeight: Math.round(rect.height / prefs.zoom) } : {}),
    monitorKey: monitor.key, anchorX: maxX ? clamp((rect.x - work.x) / maxX, 0, 1) : 0, anchorY: maxY ? clamp((rect.y - work.y) / maxY, 0, 1) : 0 };
  next.sourceWidth = clamp(next.sourceWidth, 480, 1280); next.sourceHeight = clamp(next.sourceHeight, 160, 256);
  if (gesture === 'idle' && Math.abs(rect.y + rect.height - (work.y + work.height)) <= SNAP_THRESHOLD_LOGICAL * monitor.scaleFactor) {
    next.placement = 'snapped'; next.snapEdge = 'bottom'; next.anchorY = 1;
  } else { next.placement = 'free'; delete next.snapEdge; }
  return prefsSchema.parse(next);
}
export function compactCssViewport(geometry: CompactGeometry, dpr: number): { width: number; height: number } {
  if (!Number.isFinite(dpr) || dpr <= 0) throw new Error('Device pixel ratio must be positive');
  return { width: geometry.rect.width / dpr, height: geometry.rect.height / dpr };
}
/** Convert work-area bounds to the client-area region available after native decorations. */
export function clientWorkArea(monitorInput: DesktopMonitor, insets: FrameInsets): DesktopMonitor {
  const monitor = monitorSchema.parse(monitorInput), { workArea } = monitor;
  const left = Math.max(0, insets.left), top = Math.max(0, insets.top), right = Math.max(0, insets.right), bottom = Math.max(0, insets.bottom);
  return { ...monitor, workArea: { x: workArea.x + left, y: workArea.y + top,
    width: Math.max(1, workArea.width - left - right), height: Math.max(1, workArea.height - top - bottom) } };
}
export function clientRectToFrameRect(rect: PhysicalRect, insets: FrameInsets): PhysicalRect {
  return { x: rect.x - insets.left, y: rect.y - insets.top, width: rect.width + insets.left + insets.right, height: rect.height + insets.top + insets.bottom };
}
export function snapCompactBottom(rect: PhysicalRect, monitor: DesktopMonitor): PhysicalRect {
  const valid = constrainCompactRect(rect, monitor);
  return { ...valid, y: Math.round(monitor.workArea.y + monitor.workArea.height - valid.height) };
}
export function settleClientGeometry(prefs: CompactPrefs, rect: PhysicalRect, monitor: DesktopMonitor, gesture: GestureState): { prefs: CompactPrefs; rect: PhysicalRect } {
  const measured = normalizedCompactPrefs(prefs, rect, monitor, gesture);
  let target = constrainCompactRect({ ...rect, width: measured.sourceWidth * measured.zoom, height: measured.sourceHeight * measured.zoom }, monitor);
  // Measure a user resize first, then resolve snapping with idle semantics.
  // Re-normalizing as moving here would erase the snap chosen at settle time.
  let settled = normalizedCompactPrefs(measured, target, monitor, 'idle');
  if (settled.placement === 'snapped') {
    target = snapCompactBottom(target, monitor);
    settled = normalizedCompactPrefs(settled, target, monitor, 'idle');
  }
  return { prefs: settled, rect: target };
}
export function gestureGeneration(current: number, state: GestureState): { state: GestureState; generation: number } {
  return { state, generation: current + 1 };
}
export function acceptsGeometryPoll(currentGeneration: number, pollGeneration: number, state: GestureState): boolean {
  return state === 'idle' && currentGeneration === pollGeneration;
}
export function geometryGenerationCurrent(currentGeneration: number, observedGeneration: number): boolean {
  return currentGeneration === observedGeneration;
}
export function currentAnchor(rect: PhysicalRect, monitor: DesktopMonitor): PhysicalPoint {
  const constrained = constrainCompactRect(rect, monitor), work = monitor.workArea;
  const maxX = Math.max(0, work.width - constrained.width), maxY = Math.max(0, work.height - constrained.height);
  return { x: maxX ? clamp((constrained.x - work.x) / maxX, 0, 1) : 0, y: maxY ? clamp((constrained.y - work.y) / maxY, 0, 1) : 0 };
}
