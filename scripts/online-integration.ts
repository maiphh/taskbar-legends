import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { CLIENT_RULES_ID } from '../src/online/rules-id';

const url = process.env.VITE_SUPABASE_URL, anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Set the local Supabase variables in ignored .env.local first.');
const apiUrl = `${url.replace(/\/$/, '')}/functions/v1/game-api`, mailpit = 'http://127.0.0.1:54324';
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
type SessionUser = { email: string; id: string; token: string };

async function emailCode(email: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const messagesResponse = await fetch(`${mailpit}/api/v1/messages`);
    if (messagesResponse.ok) {
      const page = await messagesResponse.json() as { messages?: { ID?: string; To?: unknown }[] };
      const target = page.messages?.find(message => JSON.stringify(message.To ?? '').toLowerCase().includes(email.toLowerCase()));
      if (target?.ID) {
        const response = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(target.ID)}`);
        if (response.ok) {
          const value = await response.json() as Record<string, unknown>;
          const content = [value.Text, value.HTML, value.Snippet].filter(item => typeof item === 'string').join('\n');
          const match = content.match(/(?:^|\D)(\d{6,8})(?:\D|$)/);
          if (match?.[1]) return match[1];
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Local mail inbox did not receive a numeric OTP code.');
}

async function login(): Promise<SessionUser> {
  const email = `online-${randomUUID()}@example.test`, client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: sendError } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  assert.equal(sendError, null, 'email OTP should be sent through local Auth');
  const code = await emailCode(email);
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  assert.equal(error, null, 'numeric email OTP should verify');
  assert.ok(data.user && data.session, 'verified OTP should produce a user session');
  return { email, id: data.user.id, token: data.session.access_token };
}
async function call(user: SessionUser | null, body: Record<string, unknown>, token?: string): Promise<{ status: number; value: Record<string, unknown> }> {
  const response = await fetch(apiUrl, { method: 'POST', headers: { apikey: anonKey!, ...(user || token ? { authorization: `Bearer ${token ?? user?.token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json() as Record<string, unknown>;
  return { status: response.status, value };
}
async function bootstrap(user: SessionUser, expectStarterKit = false) {
  const result = await call(user, { op: 'bootstrap', requestId: `bootstrap:${randomUUID()}`, rulesId: CLIENT_RULES_ID });
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal(result.value.rulesId, CLIENT_RULES_ID);
  const state = result.value.account as { rng: number; seed: number; inventory: unknown[] };
  assert.equal(state.rng, 0, 'public snapshots must never contain the server RNG cursor');
  if (expectStarterKit) assert.equal(state.inventory.length, 3, 'new account starts with server-granted starter kit');
  return result;
}

const first = await login();
const second = await login();
const [firstBoot, concurrentFirstBoot] = await Promise.all([bootstrap(first, true), bootstrap(first, true)]);
const secondBoot = await bootstrap(second, true);
assert.deepEqual(concurrentFirstBoot.value.account, firstBoot.value.account, 'simultaneous first bootstrap converges on one server account');
assert.notEqual(first.id, second.id, 'OTP creates separate users');
assert.notDeepEqual((firstBoot.value.account as { seed: number }).seed, (secondBoot.value.account as { seed: number }).seed, 'account IDs are independently seeded');

const missing = await call(null, { op: 'bootstrap', requestId: 'unauth', rulesId: CLIENT_RULES_ID });
assert.equal(missing.status, 401, 'unauthenticated function requests are rejected');
const forged = await call(null, { op: 'bootstrap', requestId: 'forged', rulesId: CLIENT_RULES_ID }, 'not.a.valid.session');
assert.equal(forged.status, 401, 'forged bearer token is rejected by Auth validation');
const injected = await call(first, { op: 'sync', requestId: 'inject', rulesId: CLIENT_RULES_ID, expectedRevision: 0, presence: 'active', gold: 1, state: {} });
assert.equal(injected.status, 400, 'client cannot submit balances or account state');
const foreignOwner = await call(first, { op: 'bootstrap', requestId: 'foreign', rulesId: CLIENT_RULES_ID, userId: second.id });
assert.equal(foreignOwner.status, 400, 'client cannot select another user ID');

const directRead = await fetch(`${url}/rest/v1/game_accounts?select=user_id`, { headers: { apikey: anonKey!, authorization: `Bearer ${first.token}` } });
assert.ok(directRead.status === 401 || directRead.status === 403, 'authenticated users cannot read private account ledger rows directly');
const privateRow = await admin.from('game_accounts').select('state').eq('user_id', first.id).single();
assert.equal(privateRow.error, null);
assert.notEqual((privateRow.data.state as { rng: number }).rng, 0, 'database retains the private authoritative RNG cursor');

const initialRevision = Number(firstBoot.value.revision);
const retryBody = { op: 'sync', requestId: 'duplicate-heartbeat', rulesId: CLIENT_RULES_ID, expectedRevision: initialRevision, presence: 'active' };
const [retryA, retryB] = await Promise.all([call(first, retryBody), call(first, retryBody)]);
assert.equal([retryA.status, retryB.status].filter(status => status === 200).length, 1, 'one parallel heartbeat wins the account revision');
assert.equal([retryA.status, retryB.status].filter(status => status === 409).length, 1, 'duplicate heartbeat receives a refresh conflict without a second settlement');
let revision = Number((retryA.status === 200 ? retryA : retryB).value.revision);

const race = await Promise.all([
  call(first, { op: 'sync', requestId: 'race-a', rulesId: CLIENT_RULES_ID, expectedRevision: revision, presence: 'active' }),
  call(first, { op: 'sync', requestId: 'race-b', rulesId: CLIENT_RULES_ID, expectedRevision: revision, presence: 'paused' }),
]);
assert.equal(race.filter(value => value.status === 200).length, 1, 'only one concurrent operation may commit a shared revision');
assert.equal(race.filter(value => value.status === 409).length, 1, 'the competing revision is rejected for refresh');
revision = Number(race.find(value => value.status === 200)?.value.revision);
const heartbeatRows = await admin.from('game_requests').select('request_id').eq('user_id', first.id);
assert.equal(heartbeatRows.error, null);
assert.equal(heartbeatRows.data.length, 0, 'high-frequency syncs do not accumulate permanent receipt rows');

const oldCheckpoint = new Date(Date.now() - 9 * 60 * 60 * 1000), activeUntil = new Date(oldCheckpoint.getTime() + 15_000);
const changed = await admin.from('game_accounts').update({ checkpoint_at: oldCheckpoint.toISOString(), active_until: activeUntil.toISOString(), paused: false, remainder_ms: 0 }).eq('user_id', first.id);
assert.equal(changed.error, null, 'service-only fixture sets a stale checkpoint');
const capped = await call(first, { op: 'sync', requestId: 'eight-hour-cap', rulesId: CLIENT_RULES_ID, expectedRevision: revision, presence: 'inactive' });
assert.equal(capped.status, 200, JSON.stringify(capped.value));
const cappedResult = capped.value.offline as { seconds: number; rawSeconds: number; capped: boolean };
assert.equal(cappedResult.seconds, 8 * 3600, 'server uses the configured offline cap');
assert.ok(cappedResult.rawSeconds > 8 * 3600 && cappedResult.capped, 'server measures and reports excess from its database clock');
revision = Number(capped.value.revision);
const afterCap = await call(first, { op: 'sync', requestId: 'after-cap', rulesId: CLIENT_RULES_ID, expectedRevision: revision, presence: 'inactive' });
assert.equal(afterCap.status, 200);
assert.equal(((afterCap.value.state as { stats: { offlineSeconds: number } }).stats.offlineSeconds), 8 * 3600, 'the consumed excess is not claimable a second time');

// A real command executes and settles as one durable revision, even on a retry.
const beforePull = await bootstrap(first), pullRevision = Number(beforePull.value.revision);
const grantPulls = await admin.from('game_accounts').update({ tickets: 100 }).eq('user_id', first.id);
assert.equal(grantPulls.error, null, 'service fixture grants enough tickets for one ten-pull');
const pullBody = { op: 'command', requestId: 'atomic-ten-pull', rulesId: CLIENT_RULES_ID, expectedRevision: pullRevision,
  presence: 'inactive', action: { type: 'pullMany', count: 10 }, pullCount: 10 };
const pull = await call(first, pullBody);
assert.equal(pull.status, 200, JSON.stringify(pull.value));
assert.equal((pull.value as { accepted: boolean }).accepted, true, 'the whole ten-pull is accepted atomically');
const pulledState = pull.value.state as { tickets: number; stats: { pulls: number } };
assert.equal(pulledState.stats.pulls, 10, 'one command commits all ten pulls');
assert.ok(pulledState.tickets < 100, 'the server charges the account ledger');
const commandReceipt = await admin.from('game_requests').select('request_id,kind,result').eq('user_id', first.id).eq('request_id', 'atomic-ten-pull').single();
assert.equal(commandReceipt.error, null);
assert.equal(commandReceipt.data.kind, 'command', 'economic action retains a durable receipt');
assert.equal((commandReceipt.data.result as { state: { rng: number } }).state.rng, 0, 'durable command result hides the private RNG cursor');
const pullRetry = await call(first, pullBody);
assert.deepEqual(pullRetry.value, pull.value, 'retry returns the identical ten-pull receipt without advancing RNG twice');
const pullPayloadConflict = await call(first, { ...pullBody, action: { type: 'pullMany', count: 1 }, pullCount: 1 });
assert.equal(pullPayloadConflict.status, 409, 'request receipt cannot be replayed with another pull count');
const unsupportedPullField = await call(first, { ...pullBody, requestId: 'invalid-ten-pull', action: { type: 'pullMany', count: 10, tickets: 100 } });
assert.equal(unsupportedPullField.status, 400, 'multi-pull rejects unrecognized action fields');

// Rejected business commands settle once without storing large permanent receipts.
let rejectedRevision = Number(pull.value.revision);
const rejectedBody = { op: 'command', requestId: 'rejected-upgrade-0', rulesId: CLIENT_RULES_ID, expectedRevision: rejectedRevision,
  presence: 'inactive', action: { type: 'upgrade', gearId: 'missing-item' } };
const rejected = await call(first, rejectedBody);
assert.equal(rejected.status, 200, JSON.stringify(rejected.value));
assert.equal((rejected.value as { accepted: boolean }).accepted, false, 'invalid owned-item action is a business rejection');
assert.match(String((rejected.value as { reason: string }).reason), /gear|item/i);
const rejectedRetry = await call(first, rejectedBody);
assert.equal(rejectedRetry.status, 200, 'business rejection keeps a durable compact receipt');
assert.deepEqual(rejectedRetry.value, rejected.value, 'rejected command retry preserves the original reason and current account result');
const rejectedPayloadConflict = await call(first, { ...rejectedBody, action: { type: 'autoEquip' } });
assert.equal(rejectedPayloadConflict.status, 409, 'rejected request ID cannot be reused for a different action');
rejectedRevision = Number(rejected.value.revision);
for (let i = 1; i < 59; i += 1) {
  const result = await call(first, { ...rejectedBody, requestId: `rejected-upgrade-${i}`, expectedRevision: rejectedRevision });
  assert.equal(result.status, 200, `rejected command ${i} stays within the rate window`);
  assert.equal((result.value as { accepted: boolean }).accepted, false);
  rejectedRevision = Number(result.value.revision);
}
const commandReceipts = await admin.from('game_requests').select('request_id').eq('user_id', first.id);
assert.equal(commandReceipts.data?.length, 60, 'heartbeat history is absent and accepted/rejected commands retain compact idempotency receipts');
const rejectionReceipt = await admin.from('game_requests').select('result').eq('user_id', first.id).eq('request_id', 'rejected-upgrade-0').single();
assert.equal(rejectionReceipt.error, null);
assert.equal('state' in rejectionReceipt.data.result, false, 'rejected receipt stores no duplicate account snapshot');
const limited = await call(first, { ...rejectedBody, requestId: 'command-rate-limit', expectedRevision: rejectedRevision });
assert.equal(limited.status, 429, 'server throttles repeated rejected command writes');
assert.match(String(limited.value.error), /Retry in/i, 'rate limit gives the UI a useful wait message');
const unchangedAfterLimit = await admin.from('game_accounts').select('revision,tickets,command_count').eq('user_id', first.id).single();
assert.equal(Number(unchangedAfterLimit.data?.revision), rejectedRevision, 'rate-limited request performs no account write');
assert.equal(Number(unchangedAfterLimit.data?.tickets), pulledState.tickets, 'rate-limited request cannot change wallet balance');
const commandCountAtLimit = Number(unchangedAfterLimit.data?.command_count);

const acceptedRetryAfterLimit = await call(first, pullBody);
assert.equal(acceptedRetryAfterLimit.status, 200, 'accepted retry after 429 returns the prior receipt before the rate counter');
assert.deepEqual(acceptedRetryAfterLimit.value, pull.value, 'accepted retry after 429 keeps the original ten-pull receipt');
const afterAcceptedRetry = await admin.from('game_accounts').select('revision,tickets,command_count').eq('user_id', first.id).single();
assert.equal(Number(afterAcceptedRetry.data?.revision), rejectedRevision, 'accepted retry after 429 does not advance revision');
assert.equal(Number(afterAcceptedRetry.data?.tickets), pulledState.tickets, 'accepted retry after 429 does not change tickets');
assert.equal(Number(afterAcceptedRetry.data?.command_count), commandCountAtLimit, 'accepted retry after 429 does not bump command_count');
const acceptedPayloadConflictAfterLimit = await call(first, { ...pullBody, action: { type: 'pullMany', count: 1 }, pullCount: 1 });
assert.equal(acceptedPayloadConflictAfterLimit.status, 409, 'accepted id keeps request_conflict after the rate limit without updating the row');

const rejectedRetryAfterLimit = await call(first, rejectedBody);
assert.equal(rejectedRetryAfterLimit.status, 200, 'rejected id still one row and original reason after 429');
assert.equal((rejectedRetryAfterLimit.value as { accepted: boolean }).accepted, false);
assert.equal(String((rejectedRetryAfterLimit.value as { reason: string }).reason), String((rejected.value as { reason: string }).reason), 'rejected id still one row and original reason');
const rejectedRowsAfterLimit = await admin.from('game_requests').select('request_id').eq('user_id', first.id).eq('request_id', 'rejected-upgrade-0');
assert.equal(rejectedRowsAfterLimit.data?.length, 1, 'rejected id still one row and original reason');
const afterRejectedRetry = await admin.from('game_accounts').select('revision,tickets,command_count').eq('user_id', first.id).single();
assert.equal(Number(afterRejectedRetry.data?.revision), rejectedRevision, 'rejected receipt replay after 429 does not advance revision');
assert.equal(Number(afterRejectedRetry.data?.command_count), commandCountAtLimit, 'rejected receipt replay after 429 does not bump command_count');

// Lease settlement is derived from a DB timestamp and capped at fifteen seconds.
const dbClock = await admin.rpc('online_db_now');
assert.equal(dbClock.error, null);
const leaseStart = new Date(new Date(String(dbClock.data)).getTime() - 15_000);
const leaseEnd = new Date(String(dbClock.data));
const leaseFixture = await admin.from('game_accounts').update({ checkpoint_at: leaseStart.toISOString(), active_until: leaseEnd.toISOString(), paused: false, remainder_ms: 0 }).eq('user_id', second.id);
assert.equal(leaseFixture.error, null, 'service fixture sets one full server-issued lease');
const secondBeforeLease = await bootstrap(second), secondRevision = Number(secondBeforeLease.value.revision);
const leaseSync = await call(second, { op: 'sync', requestId: 'bounded-active-lease', rulesId: CLIENT_RULES_ID, expectedRevision: secondRevision, presence: 'inactive' });
assert.equal(leaseSync.status, 200, JSON.stringify(leaseSync.value));
const activeState = leaseSync.value.state as { tick: number };
const beforeActiveState = secondBeforeLease.value.account as { tick: number };
assert.equal(activeState.tick - beforeActiveState.tick, 300, 'a full fifteen-second lease executes exactly 300 authoritative ticks');

// A future checkpoint caused by a backwards DB clock is refused without moving it.
const rollbackClock = await admin.rpc('online_db_now');
assert.equal(rollbackClock.error, null);
const futureCheckpoint = new Date(new Date(String(rollbackClock.data)).getTime() + 2_000).toISOString();
const rollbackFixture = await admin.from('game_accounts').update({ checkpoint_at: futureCheckpoint }).eq('user_id', second.id);
assert.equal(rollbackFixture.error, null);
const rollbackState = await admin.from('game_accounts').select('revision').eq('user_id', second.id).single();
assert.equal(rollbackState.error, null);
const rollbackResponse = await call(second, { op: 'sync', requestId: 'clock-rollback', rulesId: CLIENT_RULES_ID,
  expectedRevision: Number(rollbackState.data.revision), presence: 'inactive' });
assert.equal(rollbackResponse.status, 409, 'server refuses a database clock rollback');
const checkpointAfterRollback = await admin.from('game_accounts').select('checkpoint_at').eq('user_id', second.id).single();
assert.equal(Date.parse(String(checkpointAfterRollback.data?.checkpoint_at)), Date.parse(futureCheckpoint), 'rollback rejection leaves the checkpoint untouched');
const syncRowsAfterCases = await admin.from('game_requests').select('request_id').eq('user_id', second.id);
assert.equal(syncRowsAfterCases.data?.length, 0, 'active, offline and rejected heartbeat attempts leave no growing receipt history');

console.log('Local Supabase integration passed');
