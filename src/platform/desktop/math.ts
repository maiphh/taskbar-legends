import { z } from 'zod';

const positive = z.number().finite().positive();
export const physicalRectSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: positive, height: positive });
export type PhysicalRect = z.infer<typeof physicalRectSchema>;
export const monitorSchema = z.object({ key: z.string(), scaleFactor: positive, workArea: physicalRectSchema });
export type DesktopMonitor = z.infer<typeof monitorSchema>;
export interface CssRect { x: number; y: number; width: number; height: number }
export interface PhysicalPoint { x: number; y: number }
export function dockRect(monitor: DesktopMonitor, logicalHeight: number): PhysicalRect {
  positive.parse(logicalHeight);
  const work = monitor.workArea;
  const height = Math.min(Math.round(logicalHeight * monitor.scaleFactor), Math.floor(work.height));
  return { x: Math.round(work.x), y: Math.round(work.y + work.height - height), width: Math.floor(work.width), height };
}
export function sameRect(a: PhysicalRect, b: PhysicalRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
export function cursorHits(args: { cursor: PhysicalPoint; origin: PhysicalPoint; scaleFactor: number; regions: readonly CssRect[] }): boolean {
  const { cursor, origin, scaleFactor, regions } = args;
  if (!(scaleFactor > 0) || !Number.isFinite(scaleFactor)) return false;
  return regions.some(rect => {
    const left = Math.round(origin.x + rect.x * scaleFactor), top = Math.round(origin.y + rect.y * scaleFactor);
    const right = Math.round(origin.x + (rect.x + rect.width) * scaleFactor), bottom = Math.round(origin.y + (rect.y + rect.height) * scaleFactor);
    return rect.width > 0 && rect.height > 0 && cursor.x >= left && cursor.y >= top && cursor.x < right && cursor.y < bottom;
  });
}
