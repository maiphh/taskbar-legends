import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import * as Core from '../_shared/generated-game-core.js';

const MAX_BODY = 8192, LEASE_MS = 15_000;
const defaultOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'tauri://localhost', 'http://tauri.localhost']);
function json(value: unknown, status = 200, origin = '*', extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS', 'vary': 'Origin', 'cache-control': 'no-store', ...extraHeaders } });
}
function strictKeys(body: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(body).every(key => allowed.includes(key)); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
async function hashPayload(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value)), digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function iso(value: string | null | undefined): number | null { if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 200) : 'database_error'; }
async function readBodyBounded(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function handleRequest(request: Request): Promise<Response> {
  const origin = request.headers.get('origin') ?? '';
  const configured = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map(value => value.trim()).filter(Boolean);
  const origins = configured?.length ? new Set(configured) : defaultOrigins;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': !origin || origins.has(origin) ? origin || '*' : 'null',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS', 'vary': 'Origin' } });
  if (origin && !origins.has(origin)) return json({ error: 'Origin is not allowed.' }, 403, 'null');
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405, origin || '*');
  const url = Deno.env.get('SUPABASE_URL'), anonKey = Deno.env.get('SUPABASE_ANON_KEY'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json({ error: 'Online service is not configured.' }, 503, origin || '*');
  let body: Record<string, unknown>;
  try {
    const raw = await readBodyBounded(request);
    if (raw === null) return json({ error: 'Request is too large or empty.' }, 413, origin || '*');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Expected a JSON object.' }, 400, origin || '*');
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: 'Invalid JSON.' }, 400, origin || '*'); }
  const op = body.op;
  const allowed = op === 'bootstrap' ? ['op', 'requestId', 'rulesId'] : op === 'sync' ? ['op', 'requestId', 'rulesId', 'expectedRevision', 'presence']
    : op === 'command' ? ['op', 'requestId', 'rulesId', 'expectedRevision', 'presence', 'action', 'pullCount'] : [];
  if (!['bootstrap', 'sync', 'command'].includes(String(op)) || !strictKeys(body, allowed)) return json({ error: 'Invalid operation fields.' }, 400, origin || '*');
  if (body.rulesId !== Core.RULES_ID) return json({ error: 'This client uses different game rules. Update the application and retry.' }, 426, origin || '*');
  if (typeof body.requestId !== 'string' || body.requestId.length < 1 || body.requestId.length > 120) return json({ error: 'Invalid request ID.' }, 400, origin || '*');
  if (op !== 'bootstrap' && (!Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number) < 0)) return json({ error: 'Invalid account revision.' }, 400, origin || '*');
  const presence = body.presence ?? 'active';
  if (op !== 'bootstrap' && presence !== 'active' && presence !== 'inactive' && presence !== 'paused') return json({ error: 'Invalid activity state.' }, 400, origin || '*');
  if (op === 'command') {
    if (!body.action || typeof body.action !== 'object' || Array.isArray(body.action)) return json({ error: 'A game action is required.' }, 400, origin || '*');
    if (body.pullCount !== undefined && body.pullCount !== 1 && body.pullCount !== 10) return json({ error: 'Pull count must be one or ten.' }, 400, origin || '*');
    const action = body.action as Record<string, unknown>;
    if (body.pullCount !== undefined && (!strictKeys(action, ['type', 'count']) || action.type !== 'pullMany' || action.count !== body.pullCount)) return json({ error: 'Invalid multi-pull request.' }, 400, origin || '*');
    if (body.pullCount === undefined && action.type === 'pullMany') return json({ error: 'A multi-pull count is required.' }, 400, origin || '*');
  }
  const token = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token.length > 8192) return json({ error: 'Sign in is required.' }, 401, origin || '*');
  const auth = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user) return json({ error: 'Session is invalid or expired.' }, 401, origin || '*');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (op === 'bootstrap') {
    const { data: existing, error: readError } = await admin.rpc('read_game_account', { p_user_id: user.id });
    if (readError) { console.error('online bootstrap read failed:', safeMessage(readError)); return json({ error: 'Account service unavailable.' }, 503, origin || '*'); }
    if (!existing) {
      const { data: nowValue, error: clockError } = await admin.rpc('online_db_now');
      if (clockError || !nowValue) return json({ error: 'Account service unavailable.' }, 503, origin || '*');
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
      const initial = Core.createAccount(seed), parts = Core.splitAccount(initial), now = new Date(String(nowValue));
      const { error } = await admin.rpc('bootstrap_game_account', { p_user_id: user.id, p_rules_id: Core.RULES_ID,
        p_state: parts.state, p_gold: parts.gold, p_tickets: parts.tickets, p_checkpoint_at: now.toISOString(), p_remainder_ms: 0,
        p_active_until: new Date(now.getTime() + LEASE_MS).toISOString(), p_items: parts.inventory });
      if (error) { console.error('online bootstrap failed:', safeMessage(error)); return json({ error: 'Could not create online account.' }, 503, origin || '*'); }
    }
    const loaded = await loadAccount(admin, user.id);
    if (loaded.error) return json({ error: 'Could not load online account.' }, 503, origin || '*');
    if (loaded.account!.rules_id !== Core.RULES_ID) return json({ error: 'Online account rules require an application update.', rulesId: loaded.account!.rules_id }, 426, origin || '*');
    return json({ accepted: true, account: Core.publicAccountState(loaded.state!), revision: loaded.account!.revision, rulesId: Core.RULES_ID, paused: loaded.account!.paused }, 200, origin || '*');
  }

  const idempotencyPayload = op === 'command'
    ? { op, rulesId: body.rulesId, expectedRevision: body.expectedRevision, presence, action: body.action, ...(body.pullCount === undefined ? {} : { pullCount: body.pullCount }) }
    : { op, rulesId: body.rulesId, expectedRevision: body.expectedRevision, presence };
  const payloadHash = await hashPayload(idempotencyPayload);
  const loaded = await loadAccount(admin, user.id);
  if (loaded.error || !loaded.account || !loaded.state) return json({ error: 'Online account is unavailable. Bootstrap first.' }, 404, origin || '*');
  const account = loaded.account;
  if (account.rules_id !== Core.RULES_ID) return json({ error: 'Online account rules require an application update.' }, 426, origin || '*');
  const { data: nowValue, error: clockError } = await admin.rpc('online_db_now');
  if (clockError || !nowValue) return json({ error: 'Account service unavailable.' }, 503, origin || '*');
  const now = new Date(String(nowValue)), nowMs = now.getTime(), checkpointMs = iso(account.checkpoint_at);
  if (checkpointMs === null || checkpointMs > nowMs) return json({ error: 'Server clock moved backwards; account time was not changed. Retry shortly.' }, 409, origin || '*');
  let state = loaded.state, remainderMs = Number(account.remainder_ms), activeMs = 0, offlineMs = 0;
  if (!account.paused) {
    const activeUntil = iso(account.active_until);
    const activeEnd = activeUntil === null ? checkpointMs : Math.max(checkpointMs, Math.min(nowMs, activeUntil));
    activeMs = Math.max(0, Math.min(LEASE_MS, activeEnd - checkpointMs));
    const offlineStart = activeUntil === null ? checkpointMs : Math.max(checkpointMs, Math.min(nowMs, activeUntil));
    offlineMs = Math.max(0, nowMs - offlineStart);
  }
  const settled = Core.settleInterval(state, activeMs, offlineMs, remainderMs);
  remainderMs = settled.remainderMs;
  let accepted = true, reason: string | undefined;
  if (op === 'command') {
    try {
      const result = Core.applyCommand(state, body.action, body.pullCount as 1 | 10 | undefined);
      state = result.state;
      if (result.reason) { accepted = false; reason = result.reason; }
    } catch (error) { accepted = false; reason = error instanceof Error ? error.message : 'Invalid action.'; }
  }
  const paused = presence === 'paused';
  const activeUntil = presence === 'active' ? new Date(nowMs + LEASE_MS).toISOString() : null;
  const parts = Core.splitAccount(state);
  const responseResult = { accepted, ...(reason ? { reason } : {}), requestId: body.requestId,
    ...(op === 'command' ? { state: Core.publicAccountState(state) } : {}), offline: settled.offline, rulesId: Core.RULES_ID, paused };
  const { data: result, error: commitError } = await admin.rpc('commit_game_operation', {
    p_user_id: user.id, p_request_id: body.requestId, p_payload_hash: payloadHash, p_kind: op,
    p_expected_revision: body.expectedRevision, p_rules_id: Core.RULES_ID, p_state: parts.state, p_gold: parts.gold,
    p_tickets: parts.tickets, p_checkpoint_at: now.toISOString(), p_remainder_ms: remainderMs,
    p_active_until: activeUntil, p_paused: paused, p_items: parts.inventory, p_result: responseResult,
  });
  if (commitError) { console.error('online operation commit failed:', safeMessage(commitError)); return json({ error: 'Account service unavailable.' }, 503, origin || '*'); }
  const outcome = result as Record<string, unknown> | null;
  if (!outcome) return json({ error: 'Account service returned no result.' }, 503, origin || '*');
  if (outcome.error === 'request_conflict') return json({ error: 'Request ID was already used for a different operation.', code: 'request_conflict' }, 409, origin || '*');
  if (outcome.error === 'stale_revision') return json({ error: 'Account changed elsewhere; refreshing before retrying.', code: 'stale_revision', revision: outcome.revision }, 409, origin || '*');
  if (outcome.error === 'rules_mismatch') return json({ error: 'Online account rules require an application update.', code: 'rules_mismatch' }, 426, origin || '*');
  if (outcome.error === 'clock_rollback') return json({ error: 'Server clock moved backwards; account time was not changed. Retry shortly.', code: 'clock_rollback' }, 409, origin || '*');
  if (outcome.error === 'rate_limited') {
    const retryAfter = Math.max(1, Number(outcome.retryAfterSeconds) || 60);
    return json({ error: `Account change limit reached. Retry in ${retryAfter} seconds.` }, 429, origin || '*', { 'retry-after': String(retryAfter) });
  }
  if (op === 'sync') {
    // Heartbeats are intentionally not stored as full durable receipts. The revision CAS and
    // checkpoint make replay safe; an old lost response refreshes the current snapshot instead.
    const current = await loadAccount(admin, user.id);
    if (current.error || !current.account || !current.state) return json({ error: 'Could not load online account.' }, 503, origin || '*');
    return json({ ...(outcome as Record<string, unknown>), state: Core.publicAccountState(current.state), revision: current.account.revision,
      rulesId: Core.RULES_ID, paused: current.account.paused }, 200, origin || '*');
  }
  if (op === 'command' && !('state' in outcome)) {
    // Rejected-command receipts are compact; retries return their original reason without
    // carrying a full state snapshot in the permanent receipt table.
    const current = await loadAccount(admin, user.id);
    if (current.error || !current.account || !current.state) return json({ error: 'Could not load online account.' }, 503, origin || '*');
    return json({ ...(outcome as Record<string, unknown>), state: Core.publicAccountState(current.state), revision: current.account.revision,
      rulesId: Core.RULES_ID, paused: current.account.paused }, 200, origin || '*');
  }
  return json(outcome, 200, origin || '*');
}

async function loadAccount(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin.rpc('read_game_account', { p_user_id: userId });
  if (error || !data) return { account: null, state: null, error: error ?? new Error('Account missing') };
  const account = data as Record<string, unknown> & { revision: number; rules_id: string; paused: boolean; checkpoint_at: string; remainder_ms: number; active_until: string | null; inventory: unknown[] };
  try { return { account, state: Core.assembleAccount(account, account.inventory as Parameters<typeof Core.assembleAccount>[1]), error: null }; }
  catch { return { account, state: null, error: new Error('Stored account failed validation') }; }
}

Deno.serve(handleRequest);
