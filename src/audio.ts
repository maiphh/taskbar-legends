import type { GameEvent } from './core/model';
// Intentional M1 stub. Adapter is isolated so audio can never affect simulation state.
export interface AudioAdapter { consume(events: readonly GameEvent[]): void; dispose(): void }
export const audio: AudioAdapter = { consume: () => undefined, dispose: () => undefined };
