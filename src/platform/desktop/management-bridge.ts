import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import type { Action } from '../../core/model';
import type { HeroGearComparison, ManagementReply, ManagementSnapshot } from '../../management/authority';

const messageSchema = z.object({ kind: z.enum(['snapshot', 'command', 'compare', 'pause', 'audio-get', 'audio-set', 'compact-get', 'compact-set', 'cue', 'account-status', 'account-send-code', 'account-verify-code', 'account-sign-out']), clientId: z.string().max(80), requestId: z.string().max(120),
  replyTo: z.string().optional(),
  commandRequestId: z.string().max(120).optional(), expectedRevision: z.number().int().nonnegative().optional(), action: z.unknown().optional(), heroId: z.string().optional(), gearId: z.string().optional(), paused: z.boolean().optional(),
  email: z.string().max(254).optional(), code: z.string().max(8).optional(),
  settings: z.object({ muted: z.boolean(), volume: z.number().finite().min(0).max(1), buses: z.object({ music: z.number().finite().min(0).max(1), sfx: z.number().finite().min(0).max(1), ui: z.number().finite().min(0).max(1) }).strict().optional() }).strict().optional(), prefs: z.unknown().optional(),
  cue: z.string().regex(/^[a-z0-9_:]{1,48}$/).optional() }).strict();
type AudioValue = { muted: boolean; volume: number; buses?: { music: number; sfx: number; ui: number } };
export interface BridgeAuthority {
  snapshot(): Promise<ManagementSnapshot>;
  execute(action: Action | { type: 'pullMany'; count: 1 | 10 }, revision: number, requestId: string): Promise<ManagementReply>;
  compare(heroId: string, gearId: string): Promise<HeroGearComparison | null>;
}
export interface MainManagementHooks { audio(): AudioValue; setAudio(value: AudioValue): void; cue?(key: string): void; setPaused(value: boolean): Promise<void>; compactPrefs(): unknown; setCompactPrefs(value: unknown): void;
  accountStatus(): unknown; sendLoginCode(email: string): Promise<void>; verifyLoginCode(email: string, code: string): Promise<void>; signOut(): Promise<void> }
export async function startManagementBridge(authority: BridgeAuthority, hooks: MainManagementHooks): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const unlisten = await listen<unknown>('management://request', event => {
    void (async () => {
      const transport = typeof event.payload === 'object' && event.payload !== null && 'requestId' in event.payload && typeof event.payload.requestId === 'string' ? event.payload.requestId : '';
      const replyTo = typeof event.payload === 'object' && event.payload !== null && 'replyTo' in event.payload && typeof event.payload.replyTo === 'string' ? event.payload.replyTo : 'management';
      try {
        const message = messageSchema.parse(event.payload);
        let payload: Record<string, unknown>;
        switch (message.kind) {
          case 'snapshot': payload = { requestId: message.requestId, accepted: true, snapshot: await authority.snapshot() }; break;
          case 'command': {
            const commandRequestId = message.commandRequestId ?? message.requestId, revision = message.expectedRevision ?? -1;
            const action = message.action as { type?: string; count?: number } | undefined;
            if (!action) throw new Error('Missing action');
            const result = await authority.execute(action as Action | { type: 'pullMany'; count: 1 | 10 }, revision, commandRequestId);
            payload = { requestId: message.requestId, accepted: result.accepted, snapshot: result.snapshot, reason: result.reason }; break;
          }
          case 'compare': payload = { requestId: message.requestId, accepted: true, result: message.heroId && message.gearId ? await authority.compare(message.heroId, message.gearId) : null }; break;
          case 'pause': await hooks.setPaused(message.paused === true); payload = { requestId: message.requestId, accepted: true, snapshot: await authority.snapshot() }; break;
          case 'audio-get': payload = { requestId: message.requestId, accepted: true, result: hooks.audio() }; break;
          case 'audio-set': if (!message.settings) throw new Error('Missing audio settings'); hooks.setAudio(message.settings); payload = { requestId: message.requestId, accepted: true }; break;
          case 'cue': if (!message.cue) throw new Error('Missing cue'); hooks.cue?.(message.cue); payload = { requestId: message.requestId, accepted: true }; break;
          case 'compact-get': payload = { requestId: message.requestId, accepted: true, result: hooks.compactPrefs() }; break;
          case 'compact-set': if (!message.prefs) throw new Error('Missing compact preferences'); hooks.setCompactPrefs(message.prefs); payload = { requestId: message.requestId, accepted: true, result: hooks.compactPrefs() }; break;
          case 'account-status': payload = { requestId: message.requestId, accepted: true, result: hooks.accountStatus() }; break;
          case 'account-send-code': if (!message.email) throw new Error('Enter an email address.'); await hooks.sendLoginCode(message.email); payload = { requestId: message.requestId, accepted: true, result: hooks.accountStatus() }; break;
          case 'account-verify-code': if (!message.email || !message.code) throw new Error('Enter the email and code.'); await hooks.verifyLoginCode(message.email, message.code); payload = { requestId: message.requestId, accepted: true, result: hooks.accountStatus() }; break;
          case 'account-sign-out': await hooks.signOut(); payload = { requestId: message.requestId, accepted: true, result: hooks.accountStatus() }; break;
        }
        await invoke('publish_management_reply', { targetLabel: replyTo, payload });
      } catch (error) {
        await invoke('publish_management_reply', { targetLabel: replyTo, payload: { requestId: transport, accepted: false, reason: error instanceof Error ? error.message.slice(0, 160) : 'Invalid or unavailable request.', snapshot: await authority.snapshot().catch(() => undefined) } }).catch(() => undefined);
      }
    })();
  });
  return unlisten;
}
