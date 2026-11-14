import type { AudioAdapter } from './audio';
import type { SalvageRules, V14Rule } from './config';
import type { GameEvent, GameState } from './core/model';
import type { HitRegion, Renderer } from './renderer';
import type { PanelTab, PixelUI } from './pixel-ui';
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
  /** Compact preview: the gacha reveal playing inside the PARTY CAMP Recruit tab, or null. */
  getManagementReveal?(): ReturnType<PixelUI['revealState']>;
  getLayout(): ReturnType<Renderer['getLayout']>;
  getCombatProjection(state?: GameState): ReturnType<Renderer['getCombatProjection']>;
  openPanel(tab: PanelTab | null): void;
  whenReady(): Promise<void>;
  getAssetErrors(): string[];
  /** v1.4 rules (not saved; default none = 1.3.0). */
  setV14Rules(rules: readonly V14Rule[]): V14Rule[];
  getV14Rules(): V14Rule[];
  setSalvageRules(rules: SalvageRules | 'design' | 'default'): SalvageRules;
  getSalvageRules(): SalvageRules;
  /** Pins the reveal / welcome presentation clock to an absolute ms value; null = live performance.now(). */
  freezeClock(ms: number | null): void;
  getAudio(): ReturnType<AudioAdapter['debug']>;
  /** Applies an offline absence to the running state (like a restore) and shows the welcome-back panel. */
  away(ms: number): Record<string, unknown>;
}
declare global { interface Window { __game: GameDebug } }
