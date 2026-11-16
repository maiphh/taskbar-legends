# Supabase online implementation — progress checkpoint

Status: **ready for pull request**. A review required one local-save fix; that fix is in this tree. Nothing has been deployed to hosted Supabase. The real native desktop shell was not launched.

Base commit: `e64bb32` (`feat: adjust UI`). Preserve the user's UI changes.

## Agreed scope

Supabase Postgres, Auth, and TypeScript Edge Functions for server-verified earnings, inventory, and progression. No multiplayer. The detailed specification is [SUPABASE-ONLINE-IMPLEMENTATION-PLAN.md](SUPABASE-ONLINE-IMPLEMENTATION-PLAN.md).

## Implemented in the working tree

- Supabase CLI 3.1.0, supabase-js 2.119.0, and esbuild 0.28.2 installed; environment examples and secret ignores added.
- Local Supabase configuration, OTP email template, migration `supabase/migrations/20261116000100_online_accounts.sql`, and `game-api` Edge Function.
- Portable generated game-core bundle, canonical rules fingerprint, server-owned checkpoint/economy, private RNG, atomic account reads, CAS commits, and durable economic-command receipts.
- Bounded active progression (15-second lease / 300 ticks), aggregate offline settlement with the eight-hour cap, and server-clock rollback protection.
- Sync operations use checkpoint/CAS reconciliation without permanent snapshot receipts. Economic commands have replay protection and a command-rate guard; accepted retries after 429 return prior receipts without bumping counters.
- Online gateway, browser Settings email-code authentication, and native management bridge hooks. Local and cloud accounts remain separate; local save is frozen while connecting/online/reconnecting and restored once on sign-out.
- In-memory email/OTP drafts with caret restore across Settings refreshes; OTP is never persisted to storage or bridge replies.
- Integration, browser, and benchmark scripts under `scripts/online-*`. Public Vite vars wired through CI/Pages/desktop build steps from GitHub `vars` only.
- Regression tests at `tests/online-gateway.test.ts` and `tests/management-bridge-online.test.ts`.
- Connecting from local or error freezes the local save. A checkpoint write happens only when that save was hydrated on a visible restore. A hidden startup does not overwrite `taskbar-legends:v1:party-v2` with the default state. An `error` status with no cloud snapshot still plays and saves locally until a connect freezes it.

## Verified locally

- `npm run build:online-core` / `npm run check:online-core` — generated core fresh.
- After the hidden-start checkpoint fix: `npx vitest run tests/online-gateway.test.ts tests/management-bridge-online.test.ts` — 2 files / 9 tests passed. `npm test -- --maxWorkers=2` — **43 files / 349 tests** passed. `npm run lint` exit 0.
- Earlier in the same implementation, before that last client fix: `npm run build` exit 0, `npx supabase test db` 8/8, `npm run test:online:integration` printed `Local Supabase integration passed`, `node scripts/online-benchmark.mjs` finished (local Node timing only), and `npm run test:online:ui` covered frozen-save, code re-render, reconnect abort, sign-out restore, and the second-show absence guard. Those four commands were not rerun after the last client fix.
- Real native desktop runtime was **not** launched.

Note: the preserved local DB had an older in-place `commit_game_operation` body (20/min, success-only receipts). It was synced to the migration file definition (60/hour, rejected receipts, state stripped) via `CREATE OR REPLACE` without `db reset`. Migration history version was already `20261116000100`.

## Hosted deployment dependency

The Supabase connection and target project name/reference are still pending the user's answer. No cloud credentials/project were supplied, and no hosted schema, account, or resource was changed. Resolve this before any hosted deployment or paid provisioning.

## Resume entry points

Preserved DB — do **not** `supabase db reset`. Start with exclusions for unused realtime, storage-api, imgproxy, postgres-meta, studio, logflare, vector, and supavisor. Redirect CLI stdout/stderr to an ignored log such as `artifacts/supabase-start.log` (covered by `*.log`) because it can contain local credentials; do not print that log. Ports: API `54321`, DB `54322`, mail `54324`. `npm run dev` loads `.env.local`. Online stays off unless `VITE_ONLINE_ENABLED=true` plus URL and anon key. `npm run supabase:serve` is server-side only. Hosted deploy is blocked because there is no project ref. Edge runtime in `config.toml` is already enabled, so a normal start serves `game-api`. Handler `getUser` stays mandatory while `verify_jwt = false`.

```text
npx supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,logflare,vector,supavisor > artifacts/supabase-start.log 2>&1
npm run build:online-core
npm run check:online-core
npx vitest run tests/online-gateway.test.ts tests/management-bridge-online.test.ts
npm test -- --maxWorkers=2
npm run lint
npm run build
npx supabase test db
npm run test:online:integration
node scripts/online-benchmark.mjs
npm run test:online:ui
```

Local configuration/credentials remain in ignored environment/log files. Do not paste or commit their values.
