import { createClient, type AuthChangeEvent, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { GameState, Action } from '../core/model';
import { cloneState } from '../core/model';
import { ManagementAuthority } from '../management/authority';
import type { HeroGearComparison, ManagementReply, ManagementSnapshot } from '../management/authority';
import { CLIENT_RULES_ID } from './rules-id';
import { isCurrentAccountRequest, mayAcceptAccountSnapshot } from './gateway-guards';

export type AccountMode = 'local' | 'connecting' | 'online' | 'reconnecting' | 'error';
export interface AccountStatus { mode: AccountMode; enabled: boolean; email: string | null; lastSync: string | null; message: string; paused: boolean }
type OperationResult = { accepted: boolean; revision: number; state?: GameState; account?: GameState; requestId: string; reason?: string; offline?: unknown; rulesId: string; paused?: boolean };
type Presence = 'active' | 'inactive' | 'paused';
type GatewayOptions = { onCloudState(state: GameState | null, reason?: 'account-switch' | 'sign-out'): void; onStatus(status: AccountStatus): void };
export interface OnlineGatewayDependencies { url: string; anonKey: string; enabled: boolean; client: SupabaseClient | null; fetcher?: typeof fetch }
const config = import.meta.env;

/** One browser/native main-window owner for OTP, server snapshots, and every economic command. */
export class OnlineGateway {
  private readonly supabase: SupabaseClient | null;
  private readonly url: string;
  private readonly anonKey: string;
  private readonly enabled: boolean;
  private readonly fetcher: typeof fetch;
  private mode: AccountMode = 'local';
  private email: string | null = null;
  private accountId: string | null = null;
  private session: Session | null = null;
  private cloudState: GameState | null = null;
  private cloudOwnerId: string | null = null;
  private revision = 0;
  private paused = false;
  private lastSync: string | null = null;
  private message = '';
  private statusListener: { unsubscribe(): void } | null = null;
  private pollTimer = 0;
  private connectTask: Promise<void> | null = null;
  private connectingUserId: string | null = null;
  private generation = 0;
  private lastFailedRequest: { fingerprint: string; requestId: string } | null = null;
  constructor(private readonly local: ManagementAuthority, private readonly options: GatewayOptions, dependencies?: OnlineGatewayDependencies) {
    this.url = dependencies?.url ?? config.VITE_SUPABASE_URL ?? '';
    this.anonKey = dependencies?.anonKey ?? config.VITE_SUPABASE_ANON_KEY ?? '';
    this.enabled = dependencies?.enabled ?? (config.VITE_ONLINE_ENABLED === 'true' && !!this.url && !!this.anonKey);
    this.fetcher = dependencies?.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.supabase = dependencies ? dependencies.client : this.enabled
      ? createClient(this.url, this.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
    this.statusListener = this.supabase?.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
      if (event === 'SIGNED_OUT') { this.leaveCloud(); return; }
      if (session) { this.session = session; this.email = session.user.email ?? null; void this.connect(session); }
    }).data.subscription ?? null;
  }
  status(): AccountStatus { return { mode: this.mode, enabled: this.enabled, email: this.email, lastSync: this.lastSync, message: this.message, paused: this.paused }; }
  async initialize(): Promise<void> {
    if (!this.supabase) { this.publishStatus(); return; }
    const generation = this.generation;
    const { data, error } = await this.supabase.auth.getSession();
    if (generation !== this.generation) return;
    if (error) { this.mode = 'error'; this.message = 'Could not read the saved online session.'; this.publishStatus(); return; }
    if (data.session) { this.session = data.session; await this.connect(data.session); }
    else this.publishStatus();
  }
  async sendLoginCode(email: string): Promise<void> {
    const clean = email.trim().toLowerCase();
    if (!this.supabase || !this.enabled) throw new Error('Online accounts are not configured in this build.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) throw new Error('Enter a valid email address.');
    const { error } = await this.supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    if (error) throw new Error('Could not send the sign-in code. Wait before requesting another code.');
    this.email = clean; this.message = 'Code sent. Check your email, then enter the code here.'; this.publishStatus();
  }
  async verifyLoginCode(email: string, token: string): Promise<void> {
    if (!this.supabase || !this.enabled) throw new Error('Online accounts are not configured in this build.');
    const clean = email.trim().toLowerCase(), code = token.replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(code)) throw new Error('Enter the numeric code from the email.');
    const generation = this.generation;
    const { data, error } = await this.supabase.auth.verifyOtp({ email: clean, token: code, type: 'email' });
    if (error || !data.session || !data.user) throw new Error('That sign-in code is invalid or expired. Request a new code and try again.');
    if (generation !== this.generation && this.session?.user.id !== data.user.id) return;
    this.session = data.session; this.email = data.user.email ?? clean; await this.connect(data.session);
  }
  async signOut(): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase.auth.signOut();
      if (error) throw new Error('Could not sign out of the online account.');
    }
    this.leaveCloud();
  }
  async snapshot(): Promise<ManagementSnapshot> {
    if (!this.cloudState || this.mode === 'local') return this.local.snapshot();
    const snapshot = new ManagementAuthority(this.cloudState, this.paused).snapshot();
    return { ...snapshot, revision: this.revision, paused: this.paused };
  }
  async execute(action: Action | { type: 'pullMany'; count: 1 | 10 }, expectedRevision: number, requestId: string): Promise<ManagementReply> {
    if (this.mode === 'local') return this.executeLocal(action, expectedRevision, requestId);
    if (this.mode !== 'online' || !this.cloudState) throw new Error(this.message || 'Reconnect to the online account before making changes.');
    const multi = action.type === 'pullMany';
    const body = { op: 'command', requestId, rulesId: CLIENT_RULES_ID, expectedRevision, presence: this.paused ? 'paused' : 'active',
      action: multi ? action : action, ...(multi ? { pullCount: action.count } : {}) };
    const fingerprint = JSON.stringify({ expectedRevision, action });
    const stableId = this.lastFailedRequest?.fingerprint === fingerprint ? this.lastFailedRequest.requestId : requestId;
    const generation = this.generation, accountId = this.accountId;
    try {
      let result: OperationResult;
      let currentBody = { ...body, requestId: stableId };
      for (let attempt = 0; ; attempt += 1) {
        try { result = await this.request(currentBody, accountId); break; }
        catch (error) {
          if (!(error instanceof OnlineHttpError) || error.status !== 409 || error.code !== 'stale_revision' || attempt >= 2) throw error;
          await this.sync(this.paused ? 'paused' : 'active');
          if (!accountId || !isCurrentAccountRequest(generation, this.generation, accountId, this.accountId) || this.mode !== 'online') {
            throw new Error('Account changed while refreshing a command.', { cause: error });
          }
          currentBody = { ...currentBody, expectedRevision: this.revision };
        }
      }
      if (!accountId || !isCurrentAccountRequest(generation, this.generation, accountId, this.accountId)) throw new Error('Account changed while the command was in flight. Refresh before continuing.');
      this.lastFailedRequest = null; this.acceptResult(result, accountId);
      return { accepted: result.accepted, requestId: stableId, revision: this.revision, snapshot: await this.snapshot(), ...(result.reason ? { reason: result.reason } : {}) };
    } catch (error) {
      if (!accountId || !isCurrentAccountRequest(generation, this.generation, accountId, this.accountId)) throw error;
      if (error instanceof OnlineHttpError && error.status === 429) {
        this.lastFailedRequest = null; this.message = error.message; this.publishStatus(); throw error;
      }
      if (error instanceof OnlineHttpError && error.status === 409) {
        this.message = error.message; this.lastFailedRequest = null;
        await this.sync(this.paused ? 'paused' : 'active').catch(() => undefined);
        return { accepted: false, requestId: stableId, revision: this.revision, snapshot: await this.snapshot(), reason: error.message };
      }
      this.lastFailedRequest = { fingerprint, requestId: stableId };
      this.mode = 'reconnecting'; this.message = 'Connection lost. The last confirmed account is safe; reconnect before continuing.'; this.publishStatus();
      throw error;
    }
  }
  async compare(heroId: string, gearId: string): Promise<HeroGearComparison | null> {
    if (!this.cloudState || this.mode === 'local') return this.local.compareGear(heroId, gearId);
    return new ManagementAuthority(this.cloudState, this.paused).compareGear(heroId, gearId);
  }
  async pause(value: boolean): Promise<void> {
    if (this.mode === 'local') { this.local.setPaused(value); return; }
    if (this.mode !== 'online') throw new Error('Reconnect before changing online pause.');
    await this.sync(value ? 'paused' : 'active');
  }
  async sync(presence: Presence = 'active'): Promise<void> {
    if (!this.cloudState || !this.accountId || this.mode !== 'online' && this.mode !== 'reconnecting') return;
    const generation = this.generation, accountId = this.accountId;
    try {
      const result = await this.request({ op: 'sync', requestId: `sync:${crypto.randomUUID()}`, rulesId: CLIENT_RULES_ID, expectedRevision: this.revision, presence }, accountId);
      if (!isCurrentAccountRequest(generation, this.generation, accountId, this.accountId)) return;
      this.acceptResult(result, accountId);
    } catch (error) {
      if (!isCurrentAccountRequest(generation, this.generation, accountId, this.accountId)) return;
      if (!(error instanceof OnlineHttpError) || error.status !== 409) throw error;
      const current = await this.request({ op: 'bootstrap', requestId: `reconnect:${crypto.randomUUID()}`, rulesId: CLIENT_RULES_ID }, accountId);
      if (!isCurrentAccountRequest(generation, this.generation, accountId, this.accountId)) return;
      this.acceptResult(current, accountId);
    }
  }
  close(): void { window.clearInterval(this.pollTimer); this.statusListener?.unsubscribe(); }
  isOnline(): boolean { return this.mode === 'online' || this.mode === 'reconnecting'; }
  getAuthoritativeState(): GameState | null { return this.cloudState ? cloneState(this.cloudState) : null; }

  private executeLocal(action: Action | { type: 'pullMany'; count: 1 | 10 }, expectedRevision: number, requestId: string): Promise<ManagementReply> {
    if (action.type === 'pullMany') return Promise.resolve(this.local.executeManyPulls({ clientId: 'online-gateway-local', requestId, expectedRevision, count: action.count }));
    return Promise.resolve(this.local.execute({ clientId: 'online-gateway-local', requestId, expectedRevision, action }));
  }
  private async connect(session: Session): Promise<void> {
    if (!this.enabled) return;
    if (this.accountId === session.user.id && this.cloudState && this.mode === 'online') return;
    if (this.connectTask && this.connectingUserId === session.user.id) return this.connectTask;
    const generation = ++this.generation;
    this.mode = 'connecting'; this.email = session.user.email ?? null; this.publishStatus();
    if (this.accountId && this.accountId !== session.user.id) {
      this.accountId = session.user.id; this.cloudState = null; this.cloudOwnerId = null; this.revision = 0; this.paused = false; this.lastFailedRequest = null;
      this.options.onCloudState(null, 'account-switch');
    }
    const task = (async () => {
      try {
        const result = await this.request({ op: 'bootstrap', requestId: `bootstrap:${crypto.randomUUID()}`, rulesId: CLIENT_RULES_ID }, session.user.id);
        if (!isCurrentAccountRequest(generation, this.generation, session.user.id, this.session?.user.id ?? null)) return;
        this.accountId = session.user.id; this.acceptResult(result, session.user.id);
        this.mode = 'online'; this.message = 'Online account is authoritative. Your local save remains separate.';
        this.startPolling(); this.publishStatus();
      } catch {
        if (!isCurrentAccountRequest(generation, this.generation, session.user.id, this.session?.user.id ?? null)) return;
        this.mode = 'reconnecting'; this.message = 'Online account could not connect. Local play and its save remain separate.'; this.publishStatus(); this.startPolling();
      }
    })();
    this.connectTask = task; this.connectingUserId = session.user.id;
    try { await task; } finally { if (this.connectTask === task) { this.connectTask = null; this.connectingUserId = null; } }
  }
  private async request(body: Record<string, unknown>, expectedUserId: string | null = this.accountId): Promise<OperationResult & { account?: GameState }> {
    if (!this.supabase) throw new Error('Online accounts are not configured in this build.');
    const { data, error } = await this.supabase.auth.getSession();
    if (error || !data.session?.access_token) throw new Error('Sign in to continue.');
    if (expectedUserId && data.session.user.id !== expectedUserId) throw new Error('The signed-in account changed. Refresh before continuing.');
    const response = await this.fetcher(`${this.url.replace(/\/$/, '')}/functions/v1/game-api`, { method: 'POST', cache: 'no-store',
      headers: { apikey: this.anonKey, authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string' ? result.error : 'Online account request failed.';
      const code = typeof result === 'object' && result !== null && 'code' in result && typeof result.code === 'string' ? result.code : null;
      throw new OnlineHttpError(response.status, message, code);
    }
    if (!result || typeof result !== 'object' || !('state' in result || 'account' in result)) throw new Error('Online account returned an invalid response.');
    return result as OperationResult & { account?: GameState };
  }
  private acceptResult(result: OperationResult & { account?: GameState }, ownerId: string | null): void {
    const state = result.state ?? result.account;
    if (!state || result.rulesId !== CLIENT_RULES_ID) throw new Error('Online account rules differ from this application. Update and reconnect.');
    if (!ownerId || ownerId !== this.accountId || !mayAcceptAccountSnapshot(this.cloudOwnerId, ownerId, this.revision, result.revision)) return;
    this.cloudOwnerId = ownerId;
    this.cloudState = cloneState(state); this.revision = result.revision; this.paused = result.paused === true;
    this.lastSync = new Date().toISOString(); this.mode = 'online'; this.message = '';
    if (this.accountId) {
      try { localStorage.setItem(`taskbar-legends:online-cache:${this.accountId}`, JSON.stringify({ state: this.cloudState, revision: this.revision, lastSync: this.lastSync })); } catch { /* cache is best-effort and never authoritative */ }
    }
    this.options.onCloudState(cloneState(this.cloudState)); this.publishStatus();
  }
  private startPolling(): void {
    window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (!this.cloudState && this.session && this.mode === 'reconnecting') { void this.connect(this.session); return; }
      if (this.mode !== 'online' && this.mode !== 'reconnecting') return;
      const generation = this.generation, accountId = this.accountId;
      void this.sync(this.paused ? 'paused' : 'active').catch(() => {
        if (!accountId || !isCurrentAccountRequest(generation, this.generation, accountId, this.accountId)) return;
        this.mode = 'reconnecting'; this.message = 'Reconnecting to the online account; changes are paused.'; this.publishStatus();
      });
    }, 4000);
  }
  private leaveCloud(): void {
    this.generation += 1; this.connectTask = null; this.connectingUserId = null;
    const previousId = this.accountId;
    window.clearInterval(this.pollTimer); this.pollTimer = 0; this.accountId = null; this.session = null; this.cloudState = null; this.cloudOwnerId = null;
    this.email = null; this.revision = 0; this.paused = false; this.lastFailedRequest = null;
    if (previousId) { try { localStorage.removeItem(`taskbar-legends:online-cache:${previousId}`); } catch { /* best-effort cache cleanup */ } }
    this.mode = 'local'; this.message = 'Using local account. Its save is separate from online progress.';
    this.options.onCloudState(null, 'sign-out'); this.publishStatus();
  }
  private publishStatus(): void { this.options.onStatus(this.status()); }
}

export class OnlineHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code: string | null = null) { super(message); this.name = 'OnlineHttpError'; }
}
