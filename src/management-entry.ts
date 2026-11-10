import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ManagementView } from './management/view';
import type { ManagementClient } from './management/view';
import type { ManagementReply } from './management/authority';
import type { HeroGearComparison } from './management/authority';
import type { CompactPrefs } from './platform/desktop/compact-geometry';
import type { Action } from './core/model';
import { NativeRpc } from './management/native-rpc';
import { CONFIG } from './config';

type AudioValue = Awaited<ReturnType<ManagementClient['getAudio']>>;
interface ReplyEnvelope { requestId: string; accepted: boolean; snapshot?: unknown; result?: unknown; reason?: string }
class NativeManagementClient implements ManagementClient {
  private readonly rpc: NativeRpc<ReplyEnvelope>;
  private readonly clientId = crypto.randomUUID();
  private sequence = 0;
  constructor() {
    this.rpc = new NativeRpc<ReplyEnvelope>(
      receive => listen<unknown>('management://reply', event => receive(event.payload)).then(off => off),
      async (_requestId, message) => { await invoke('submit_management_message', { message }); },
      5000,
      (value): value is ReplyEnvelope => typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string' && 'accepted' in value && typeof value.accepted === 'boolean',
    );
  }
  private async request(kind: string, data: Record<string, unknown> = {}): Promise<ReplyEnvelope> {
    const requestId = `${this.clientId}:${++this.sequence}`;
    const { commandRequestId, ...payload } = data;
    const reply = await this.rpc.request(requestId, { kind, clientId: this.clientId, requestId, ...(commandRequestId ? { commandRequestId } : {}), ...payload });
    return reply;
  }
  async snapshot() {
    const result = await this.request('snapshot'); if (!result.accepted || !result.snapshot) throw new Error(result.reason ?? 'Could not read current game state.');
    return result.snapshot as Awaited<ReturnType<ManagementClient['snapshot']>>;
  }
  async execute(action: Action | { type: 'pullMany'; count: 1 | 10 }, revision: number, requestId: string): Promise<ManagementReply> {
    const result = await this.request('command', { commandRequestId: requestId, expectedRevision: revision, action });
    if (!result.snapshot) throw new Error(result.reason ?? 'Command returned no state.');
    return { accepted: result.accepted, requestId, revision: (result.snapshot as { revision: number }).revision, snapshot: result.snapshot as ManagementReply['snapshot'], ...(result.reason ? { reason: result.reason } : {}) };
  }
  async compare(heroId: string, gearId: string): Promise<HeroGearComparison | null> {
    const result = await this.request('compare', { heroId, gearId }); return (result.result as HeroGearComparison | null) ?? null;
  }
  async pause(paused: boolean): Promise<void> { await this.request('pause', { paused }); }
  async getAudio(): Promise<AudioValue> { const result = await this.request('audio-get'); return result.result as AudioValue; }
  async setAudio(value: AudioValue): Promise<void> { await this.request('audio-set', { settings: value }); }
  /** UI sounds play in the game window (the one audio context); a lost cue is harmless. */
  cue(key: string): void { void this.request('cue', { cue: key }).catch(() => undefined); }
  async getCompactPrefs(): Promise<CompactPrefs> { const result = await this.request('compact-get'); return result.result as CompactPrefs; }
  async setCompactPrefs(value: CompactPrefs): Promise<void> { await this.request('compact-set', { prefs: value }); }
  close(): void {
    this.rpc.close();
    void invoke('hide_management').catch(() => undefined);
  }
  dispose(): void { void this.rpc.dispose(); }
}

const root = document.getElementById('management-app');
if (!root) throw new Error('Management root is missing');
const client = new NativeManagementClient();
const view = new ManagementView(root, client, () => { root.hidden = true; }, { variant: 'native' });
// Native resize (Game Lead answer 3): the 760×560 panel scales by whole integers and letterboxes; below 760×560 it scrolls.
const [panelWidth = 760, panelHeight = 560] = CONFIG.ui.compactMenu.native.client;
const fit = (): void => { root.style.setProperty('--px-scale', String(Math.max(1, Math.floor(Math.min(window.innerWidth / panelWidth, window.innerHeight / panelHeight))))); };
window.addEventListener('resize', fit); fit();
let stopOpen: (() => void) | undefined, stopClose: (() => void) | undefined;
const onVisibility = (): void => { if (document.hidden) view.close(); else void view.open(); };
document.addEventListener('visibilitychange', onVisibility);
void Promise.all([
  listen('management://open', () => { void view.open(); }),
  listen('management://native-close', () => view.close()),
]).then(([open, close]) => { stopOpen = open; stopClose = close; });
window.addEventListener('pagehide', () => { document.removeEventListener('visibilitychange', onVisibility); stopOpen?.(); stopClose?.(); view.dispose(); client.dispose(); }, { once: true });
