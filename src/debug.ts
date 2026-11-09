import type { GameEvent, GameState } from './core/model';
import type { HitRegion, Renderer } from './renderer';
import type { PanelTab } from './pixel-ui';
export interface GameDebug {
  getState(): GameState;
  step(n?: number): GameState;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  input(action: unknown): GameState;
  setSeed(seed: number): GameState;
  snapshot(): string;
  load(snapshot: unknown): GameState;
  getEvents(): GameEvent[];
  getHitRegions(): HitRegion[];
  getLayout(): ReturnType<Renderer['getLayout']>;
  openPanel(tab: PanelTab | null): void;
  whenReady(): Promise<void>;
  getAssetErrors(): string[];
}
declare global { interface Window { __game: GameDebug } }
