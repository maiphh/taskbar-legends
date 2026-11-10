import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import type { ManagementAuthority } from '../../management/authority';

const messageSchema = z.object({ kind: z.enum(['snapshot', 'command', 'compare', 'pause', 'audio-get', 'audio-set', 'compact-get', 'compact-set', 'cue']), clientId: z.string().max(80), requestId: z.string().max(120),
  replyTo: z.string().optional(),
  commandRequestId: z.string().max(120).optional(), expectedRevision: z.number().int().nonnegative().optional(), action: z.unknown().optional(), heroId: z.string().optional(), gearId: z.string().optional(), paused: z.boolean().optional(),
  settings: z.object({ muted: z.boolean(), volume: z.number().finite().min(0).max(1), buses: z.object({ music: z.number().finite().min(0).max(1), sfx: z.number().finite().min(0).max(1), ui: z.number().finite().min(0).max(1) }).strict().optional() }).strict().optional(), prefs: z.unknown().optional(),
  cue: z.string().regex(/^[a-z0-9_:]{1,48}$/).optional() }).strict();
type AudioValue = { muted: boolean; volume: number; buses?: { music: number; sfx: number; ui: number } };
export interface MainManagementHooks { audio(): AudioValue; setAudio(value: AudioValue): void; cue?(key: string): void; setPaused(value: boolean): void; compactPrefs(): unknown; setCompactPrefs(value: unknown): void }
export async function startManagementBridge(authority: ManagementAuthority, hooks: MainManagementHooks): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const unlisten = await listen<unknown>('management://request', event => {
    void (async () => {
      const transport = typeof event.payload === 'object' && event.payload !== null && 'requestId' in event.payload && typeof event.payload.requestId === 'string' ? event.payload.requestId : '';
      const replyTo = typeof event.payload === 'object' && event.payload !== null && 'replyTo' in event.payload && typeof event.payload.replyTo === 'string' ? event.payload.replyTo : 'management';
      try {
        const message = messageSchema.parse(event.payload);
        let payload: Record<string, unknown>;
        switch (message.kind) {
          case 'snapshot': payload = { requestId: message.requestId, accepted: true, snapshot: authority.snapshot() }; break;
          case 'command': {
            const commandRequestId = message.commandRequestId ?? message.requestId, revision = message.expectedRevision ?? -1;
            const action = message.action as { type?: string; count?: number } | undefined;
            const result = action?.type === 'pullMany'
              ? authority.executeManyPulls({ clientId: message.clientId, requestId: commandRequestId, expectedRevision: revision, count: action.count as 1 | 10 })
              : authority.execute({ clientId: message.clientId, requestId: commandRequestId, expectedRevision: revision, action });
            payload = { requestId: message.requestId, accepted: result.accepted, snapshot: result.snapshot, reason: result.reason }; break;
          }
          case 'compare': payload = { requestId: message.requestId, accepted: true, result: message.heroId && message.gearId ? authority.compareGear(message.heroId, message.gearId) : null }; break;
          case 'pause': hooks.setPaused(message.paused === true); payload = { requestId: message.requestId, accepted: true, snapshot: authority.snapshot() }; break;
          case 'audio-get': payload = { requestId: message.requestId, accepted: true, result: hooks.audio() }; break;
          case 'audio-set': if (!message.settings) throw new Error('Missing audio settings'); hooks.setAudio(message.settings); payload = { requestId: message.requestId, accepted: true }; break;
          case 'cue': if (!message.cue) throw new Error('Missing cue'); hooks.cue?.(message.cue); payload = { requestId: message.requestId, accepted: true }; break;
          case 'compact-get': payload = { requestId: message.requestId, accepted: true, result: hooks.compactPrefs() }; break;
          case 'compact-set': if (!message.prefs) throw new Error('Missing compact preferences'); hooks.setCompactPrefs(message.prefs); payload = { requestId: message.requestId, accepted: true, result: hooks.compactPrefs() }; break;
        }
        await invoke('publish_management_reply', { targetLabel: replyTo, payload });
      } catch (error) {
        await invoke('publish_management_reply', { targetLabel: replyTo, payload: { requestId: transport, accepted: false, reason: `Invalid or unavailable request: ${String(error)}`, snapshot: authority.snapshot() } }).catch(() => undefined);
      }
    })();
  });
  return unlisten;
}
