/** Keeps persisted wall-clock checkpoints monotonic for one running game session. */
export class SaveTimestamp {
  private highWaterMs = 0;

  observe(...timestamps: number[]): number {
    for (const timestamp of timestamps) {
      if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error('Invalid save timestamp');
      this.highWaterMs = Math.max(this.highWaterMs, timestamp);
    }
    return this.highWaterMs;
  }

  next(nowMs: number): number {
    return this.observe(nowMs);
  }
}
