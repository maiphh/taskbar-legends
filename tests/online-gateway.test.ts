import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createState, step } from '../src/core/game';
import { cloneState } from '../src/core/model';
import { ManagementAuthority } from '../src/management/authority';
import { OnlineGateway } from '../src/online/gateway';
import { canPersistLocalAuthority, canRestoreLocalAuthority, isCurrentAccountRequest, mayAcceptAccountSnapshot, shouldCheckpointLocalBeforeConnecting, shouldFreezeLocalForConnecting } from '../src/online/gateway-guards';
import { syncPresentationEconomy } from '../src/online/presentation';
import { CLIENT_RULES_ID } from '../src/online/rules-id';

function response(userId: string, state: ReturnType<typeof createState>, revision: number) {
  return { accepted: true, account: state, state, revision, rulesId: CLIENT_RULES_ID, paused: false, requestId: `reply:${userId}` };
}

describe('online account response guards', () => {
  it('ignores success and error completions after logout or a switch to another user', () => {
    expect(isCurrentAccountRequest(4, 5, 'user-a', 'user-a')).toBe(false);
    expect(isCurrentAccountRequest(5, 5, 'user-a', null)).toBe(false);
    expect(isCurrentAccountRequest(5, 5, 'user-a', 'user-b')).toBe(false);
    expect(isCurrentAccountRequest(5, 5, 'user-b', 'user-b')).toBe(true);
  });

  it('allows a new low-revision owner after account reset and rejects older same-account snapshots', () => {
    expect(mayAcceptAccountSnapshot('user-a', 'user-a', 80, 79)).toBe(false);
    expect(mayAcceptAccountSnapshot('user-b', 'user-a', 5, 80)).toBe(false);
    expect(mayAcceptAccountSnapshot(null, 'user-b', 0, 0)).toBe(true);
    expect(mayAcceptAccountSnapshot('user-b', 'user-b', 5, 4)).toBe(false);
    expect(mayAcceptAccountSnapshot('user-b', 'user-b', 4, 5)).toBe(true);
  });

  it('keeps local save and timestamp writes disabled while connecting or online', () => {
    expect(canPersistLocalAuthority('local', false)).toBe(true);
    expect(canPersistLocalAuthority('error', false)).toBe(true);
    expect(canPersistLocalAuthority('connecting', false)).toBe(false);
    expect(canPersistLocalAuthority('reconnecting', false)).toBe(false);
    expect(canPersistLocalAuthority('online', true)).toBe(false);
    expect(canPersistLocalAuthority('online', false)).toBe(false);
  });

  it('restores the local save only while local or recoverable error and unfrozen', () => {
    expect(canRestoreLocalAuthority('local', false, false)).toBe(true);
    expect(canRestoreLocalAuthority('error', false, false)).toBe(true);
    expect(canRestoreLocalAuthority('local', false, true)).toBe(false);
    expect(canRestoreLocalAuthority('error', false, true)).toBe(false);
    expect(canRestoreLocalAuthority('connecting', false, true)).toBe(false);
    expect(canRestoreLocalAuthority('connecting', false, false)).toBe(false);
    expect(canRestoreLocalAuthority('reconnecting', false, true)).toBe(false);
    expect(canRestoreLocalAuthority('reconnecting', false, false)).toBe(false);
    expect(canRestoreLocalAuthority('online', true, true)).toBe(false);
    expect(canRestoreLocalAuthority('online', false, false)).toBe(false);
    expect(canRestoreLocalAuthority('local', true, false)).toBe(false);
  });

  it('freezes and optionally checkpoints when connecting from local or error', () => {
    expect(shouldFreezeLocalForConnecting('local', false)).toBe(true);
    expect(shouldFreezeLocalForConnecting('error', false)).toBe(true);
    expect(shouldFreezeLocalForConnecting('local', true)).toBe(false);
    expect(shouldFreezeLocalForConnecting('connecting', false)).toBe(false);
    expect(shouldFreezeLocalForConnecting('online', false)).toBe(false);
    expect(shouldCheckpointLocalBeforeConnecting(true, false, false, false, false)).toBe(true);
    expect(shouldCheckpointLocalBeforeConnecting(false, false, false, false, false)).toBe(false);
    expect(shouldCheckpointLocalBeforeConnecting(true, true, false, false, false)).toBe(false);
    expect(shouldCheckpointLocalBeforeConnecting(true, false, true, false, false)).toBe(false);
    expect(shouldCheckpointLocalBeforeConnecting(true, false, false, true, false)).toBe(false);
    expect(shouldCheckpointLocalBeforeConnecting(true, false, false, false, true)).toBe(false);
  });
});

describe('online presentation projection', () => {
  it('keeps farm presentation time advancing while confirming economic fields', () => {
    const authoritative = createState(27), presentation = cloneState(authoritative);
    presentation.phase = { kind: 'battle' };
    presentation.farmClock = { scale: 1, minCycleTicks: 0, elapsedTicks: 0, remainder: 0 };
    const before = presentation.farmClock?.elapsedTicks ?? 0;
    step(presentation, 1);
    const advanced = presentation.farmClock?.elapsedTicks ?? before;
    const visual = {
      farmClock: structuredClone(presentation.farmClock), tick: presentation.tick, rng: presentation.rng,
      phase: structuredClone(presentation.phase), party: structuredClone(presentation.party), enemies: structuredClone(presentation.enemies),
    };
    authoritative.gold += 17;
    authoritative.nextGearId += 3;
    authoritative.farmChestDry = 4;
    authoritative.pityLegendary = 2;
    authoritative.pityNewHero = 1;
    authoritative.gearSinceLegendary = 5;
    authoritative.gearLegendaryFound = true;
    authoritative.farmProofs = [{ stage: 1, rulesSignature: 'test', heroes: [], nativeSeconds: [12], wallSeconds: [12] }];
    authoritative.metrics = { ...authoritative.metrics, farmSamples: authoritative.metrics.farmSamples + 9 };
    authoritative.offlineAccrual = { goldFraction: 0.25, xpFraction: 0.1, clearFraction: 0.05, normalChestFraction: 0, expeditionChestFraction: 0, secondsFraction: 0.4 };
    authoritative.offlineTicketFrac = 0.3;
    authoritative.rng ^= 0xffff; authoritative.tick += 99;
    syncPresentationEconomy(presentation, authoritative);
    expect(advanced).toBeGreaterThan(before);
    expect(presentation.farmClock).toEqual(visual.farmClock);
    expect(presentation.tick).toBe(visual.tick);
    expect(presentation.rng).toBe(visual.rng);
    expect(presentation.phase).toEqual(visual.phase);
    expect(presentation.party).toEqual(visual.party);
    expect(presentation.enemies).toEqual(visual.enemies);
    expect(presentation.gold).toBe(authoritative.gold);
    expect(presentation.nextGearId).toBe(authoritative.nextGearId);
    expect(presentation.farmChestDry).toBe(authoritative.farmChestDry);
    expect(presentation.pityLegendary).toBe(authoritative.pityLegendary);
    expect(presentation.pityNewHero).toBe(authoritative.pityNewHero);
    expect(presentation.gearSinceLegendary).toBe(authoritative.gearSinceLegendary);
    expect(presentation.gearLegendaryFound).toBe(authoritative.gearLegendaryFound);
    expect(presentation.farmProofs).toEqual(authoritative.farmProofs);
    expect(presentation.metrics).toEqual(authoritative.metrics);
    expect(presentation.offlineAccrual).toEqual(authoritative.offlineAccrual);
    expect(presentation.offlineTicketFrac).toBe(authoritative.offlineTicketFrac);
  });
});

describe('OnlineGateway account-switch races', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not let delayed account A results or errors overwrite account B or local mode', async () => {
    let authListener: ((event: string, session: Session | null) => void) | undefined;
    let currentSession: Session | null = null;
    const sessions = {
      'token-a': { userId: 'user-a', state: createState(111), revision: 80 },
      'token-b': { userId: 'user-b', state: createState(222), revision: 5 },
    };
    const auth = {
      onAuthStateChange: (listener: (event: string, session: Session | null) => void) => { authListener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
      getSession: async () => ({ data: { session: currentSession }, error: null }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      verifyOtp: async () => ({ data: { session: currentSession, user: currentSession?.user }, error: null }),
      signOut: async () => { currentSession = null; authListener?.('SIGNED_OUT', null); return { error: null }; },
    };
    const client = { auth } as unknown as SupabaseClient;
    const statuses: string[] = [], cloudSeeds: (number | null)[] = [];
    const local = new ManagementAuthority(createState(7));
    let requestStarted: (() => void) | null = null;
    let pending: { mode: 'resolve' | 'reject'; resolve(response: Response): void; reject(error: Error): void } | null = null;
    let pendingMode: 'resolve' | 'reject' | null = null;
    let delayedMode: 'resolve' | 'reject' | null = null;
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { op: string };
      const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/, '') ?? '';
      const account = sessions[token as keyof typeof sessions];
      if (!account) return new Response(JSON.stringify({ error: 'bad token' }), { status: 401 });
      if (body.op === 'command' && delayedMode) {
        const mode = delayedMode; delayedMode = null;
        return new Promise<Response>((resolve, reject) => { requestStarted?.(); pendingMode = mode; pending = { mode, resolve, reject }; });
      }
      const result = response(account.userId, account.state, account.revision);
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const fakeWindow = { setInterval: vi.fn(() => 1), clearInterval: vi.fn() };
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', { hidden: false });
    vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: vi.fn() });
    const gateway = new OnlineGateway(local, { onCloudState: state => cloudSeeds.push(state?.seed ?? null), onStatus: status => statuses.push(status.mode) },
      { url: 'http://local.test', anonKey: 'public-test-key', enabled: true, client, fetcher });
    const makeSession = (id: 'a' | 'b') => ({ access_token: `token-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: 9999999999,
      refresh_token: `refresh-${id}`, user: { id: `user-${id}`, email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' } } as unknown as Session);
    try {
      currentSession = makeSession('a');
      authListener?.('SIGNED_IN', currentSession);
      for (let i = 0; i < 30 && gateway.status().mode !== 'online'; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
      expect(gateway.status().mode).toBe('online');
      expect((await gateway.snapshot()).revision).toBe(80);

      const startedA = new Promise<void>(resolve => { requestStarted = resolve; }); delayedMode = 'resolve';
      const staleSuccess = gateway.execute({ type: 'pull' }, 80, 'delayed-a').then(() => null, error => error);
      await startedA;
      currentSession = makeSession('b'); authListener?.('SIGNED_IN', currentSession);
      for (let i = 0; i < 30 && gateway.status().mode !== 'online'; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
      expect(gateway.status().mode).toBe('online');
      expect((await gateway.snapshot()).revision).toBe(5);
      expect(gateway.getAuthoritativeState()?.seed).toBe(222);
      expect(cloudSeeds).toContain(null);
      pending!.resolve(new Response(JSON.stringify(response('user-a', createState(111), 81)), { status: 200, headers: { 'content-type': 'application/json' } }));
      pending = null;
      expect(await staleSuccess).toBeInstanceOf(Error);
      expect(gateway.status().mode).toBe('online');
      expect(gateway.getAuthoritativeState()?.seed).toBe(222);

      let observedMode: 'resolve' | 'reject' | null = null;
      const startedB = new Promise<void>(resolve => { requestStarted = resolve; }); delayedMode = 'reject';
      const staleError = gateway.execute({ type: 'pull' }, 5, 'delayed-b').then(() => null, error => error);
      await startedB;
      await gateway.signOut();
      expect(gateway.status().mode).toBe('local');
      observedMode = pendingMode;
      if (observedMode === 'reject') pending!.reject(new Error('late transport failure'));
      pending = null;
      expect(await staleError).toBeInstanceOf(Error);
      expect(gateway.status().mode).toBe('local');
      expect(gateway.getAuthoritativeState()).toBeNull();
    } finally { gateway.close(); }
  });
});
