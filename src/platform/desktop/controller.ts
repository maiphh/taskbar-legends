import { cursorHits, dockRect, sameRect } from './math';
import type { CssRect, DesktopMonitor, PhysicalPoint, PhysicalRect } from './math';
export interface DesktopPort {
  monitor(): Promise<DesktopMonitor>;
  frame(): Promise<{ origin: PhysicalPoint; scaleFactor: number }>;
  cursor(): Promise<PhysicalPoint>;
  setBounds(rect: PhysicalRect, previous: PhysicalRect | undefined): Promise<void>;
  ignoreCursor(ignore: boolean): Promise<void>;
}
export class DesktopController {
  private bounds: PhysicalRect | undefined;
  private ignoring: boolean | undefined;
  constructor(private readonly port: DesktopPort) {}
  async dock(logicalHeight: number): Promise<boolean> {
    const next = dockRect(await this.port.monitor(), logicalHeight);
    if (sameRect(this.bounds, next)) return false;
    await this.port.setBounds(next, this.bounds);
    this.bounds = next;
    return true;
  }
  async hitTest(regions: readonly CssRect[]): Promise<boolean> {
    const [frame, cursor] = await Promise.all([this.port.frame(), this.port.cursor()]);
    const ignore = !cursorHits({ cursor, ...frame, regions });
    if (ignore !== this.ignoring) { await this.port.ignoreCursor(ignore); this.ignoring = ignore; }
    return ignore;
  }
}
