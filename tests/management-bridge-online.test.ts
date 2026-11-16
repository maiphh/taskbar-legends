import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../src/core/model';
import type { ManagementReply, ManagementSnapshot } from '../src/management/authority';

const mocks = vi.hoisted(() => ({
  listener: null as ((event: { payload: unknown }) => void) | null,
  invoke: vi.fn(async (...args: unknown[]) => { void args; }),
  unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (_name: string, handler: (event: { payload: unknown }) => void) => { mocks.listener = handler; return mocks.unlisten; } }));

import { startManagementBridge } from '../src/platform/desktop/management-bridge';

describe('native management bridge online routing', () => {
  beforeEach(() => { mocks.invoke.mockClear(); mocks.unlisten.mockClear(); mocks.listener = null; });

  it('forwards OTP verification and returns account status without including credentials in replies', async () => {
    const verifyLoginCode = vi.fn(async () => undefined), signOut = vi.fn(async () => undefined);
    const snapshot = { revision: 4 } as ManagementSnapshot;
    const stop = await startManagementBridge({ snapshot: async () => snapshot, execute: async () => ({ accepted: true } as ManagementReply), compare: async () => null }, {
      audio: () => ({ muted: false, volume: 0.5 }), setAudio: () => undefined, setPaused: async () => undefined,
      compactPrefs: () => ({}), setCompactPrefs: () => undefined, accountStatus: () => ({ mode: 'online' }),
      sendLoginCode: async () => undefined, verifyLoginCode, signOut,
    });
    mocks.listener!({ payload: { kind: 'account-verify-code', clientId: 'native-management', requestId: 'verify-1', email: 'player@example.test', code: '123456' } });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(verifyLoginCode).toHaveBeenCalledWith('player@example.test', '123456');
    const payload = (mocks.invoke.mock.calls[0]?.[1] as { payload?: unknown } | undefined)?.payload;
    expect(payload).toMatchObject({ requestId: 'verify-1', accepted: true, result: { mode: 'online' } });
    expect(JSON.stringify(payload)).not.toContain('123456');
    expect(JSON.stringify(payload)).not.toContain('player@example.test');
    stop();
  });

  it('awaits the async shared authority command before replying to the native window', async () => {
    let finish!: (value: ManagementReply) => void;
    const execute = vi.fn(() => new Promise<ManagementReply>(resolve => { finish = resolve; }));
    const snapshot = { revision: 8 } as ManagementSnapshot;
    const stop = await startManagementBridge({ snapshot: async () => snapshot, execute, compare: async () => null }, {
      audio: () => ({ muted: false, volume: 0.5 }), setAudio: () => undefined, setPaused: async () => undefined,
      compactPrefs: () => ({}), setCompactPrefs: () => undefined, accountStatus: () => ({ mode: 'online' }),
      sendLoginCode: async () => undefined, verifyLoginCode: async () => undefined, signOut: async () => undefined,
    });
    mocks.listener!({ payload: { kind: 'command', clientId: 'native-management', requestId: 'transport-1', commandRequestId: 'economic-1', expectedRevision: 8, action: { type: 'pull' } } });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith({ type: 'pull' } as Action, 8, 'economic-1');
    expect(mocks.invoke).not.toHaveBeenCalled();
    finish({ accepted: true, requestId: 'economic-1', revision: 9, snapshot: { revision: 9 } as ManagementSnapshot });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect((mocks.invoke.mock.calls[0]?.[1] as { payload?: unknown } | undefined)?.payload).toMatchObject({ requestId: 'transport-1', accepted: true, snapshot: { revision: 9 } });
    stop();
  });
});
