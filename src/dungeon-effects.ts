type Kind = 'hit' | 'heal' | 'death' | 'gear';
type Burst = { kind: Kind; x: number; y: number; tick: number; direction: number };

/** Bounded presentation-only pool. Every offset is an integer function of the event's age. */
export class DungeonEffects {
  private readonly slots: Burst[] = Array.from({ length: 24 }, () => ({ kind: 'hit', x: 0, y: 0, tick: -1000, direction: 1 }));
  private next = 0;
  private impact = -1000;

  clear(): void {
    for (const burst of this.slots) burst.tick = -1000;
    this.impact = -1000;
  }

  add(kind: Kind, x: number, y: number, tick: number, direction: number, bossHit: boolean): void {
    const burst = this.slots[this.next]!;
    burst.kind = kind; burst.x = x; burst.y = y; burst.tick = tick; burst.direction = direction;
    this.next = (this.next + 1) % this.slots.length;
    if (bossHit) this.impact = tick;
  }

  shake(tick: number): number {
    const age = tick - this.impact;
    return age === 0 ? 1 : age === 1 ? -1 : 0;
  }

  draw(ctx: CanvasRenderingContext2D, tick: number): void {
    for (const burst of this.slots) {
      const age = tick - burst.tick;
      if (age < 0 || age >= 8) continue;
      const { x, y, kind, direction } = burst;
      if (kind === 'gear') {
        const top = y - Math.min(6, age) * 2;
        ctx.fillStyle = '#ae7744'; ctx.fillRect(x - 3, top, 7, 7);
        ctx.fillStyle = '#ffda80'; ctx.fillRect(x - 2, top - 1, 5, 7);
        ctx.fillStyle = '#fff2c4'; ctx.fillRect(x - 1, top, 1, 4);
        continue;
      }
      for (let i = 0; i < 4; i++) {
        const dx = x + (i % 2 ? 1 : -1) * (3 + age * (1 + i % 3));
        const dy = y + (i < 2 ? -age : age) - (kind === 'hit' ? 0 : age * 2);
        if (kind === 'heal') {
          ctx.fillStyle = i % 2 ? '#98dcc2' : '#e2f8cf';
          ctx.fillRect(dx - 2, dy, 5, 1); ctx.fillRect(dx, dy - 2, 1, 5);
        } else {
          ctx.fillStyle = kind === 'death' ? (i % 2 ? '#aaa4ab' : '#6c667a') : (i % 2 ? '#ffcf75' : '#fff5cf');
          ctx.fillRect(dx, dy, kind === 'death' ? 5 - Math.floor(age / 2) : 3, 2);
        }
      }
      if (kind === 'hit' && age < 3) {
        ctx.fillStyle = '#fff5d3';
        for (let i = 0; i < 5; i++) ctx.fillRect(x + direction * (i * 3 - 7), y + 6 - i * 3, 4, 2);
      }
    }
  }
}
