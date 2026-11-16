create extension if not exists pgcrypto with schema extensions;

create table public.game_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  rules_id text not null,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  gold bigint not null default 0 check (gold >= 0),
  tickets bigint not null default 0 check (tickets >= 0),
  checkpoint_at timestamptz not null default clock_timestamp(),
  remainder_ms double precision not null default 0 check (remainder_ms >= 0 and remainder_ms < 50),
  active_until timestamptz,
  paused boolean not null default false,
  command_window_at timestamptz,
  command_count integer not null default 0 check (command_count >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.game_items (
  user_id uuid not null references public.game_accounts(user_id) on delete cascade,
  item_id text not null,
  item jsonb not null check (jsonb_typeof(item) = 'object' and item->>'id' = item_id),
  slot text not null check (slot in ('weapon', 'armor', 'charm')),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  primary key (user_id, item_id)
);

create table public.game_requests (
  user_id uuid not null references public.game_accounts(user_id) on delete cascade,
  request_id text not null check (length(request_id) between 1 and 120),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind = 'command'),
  status text not null check (status in ('complete', 'rejected')),
  base_revision bigint not null check (base_revision >= 0),
  result_revision bigint not null check (result_revision >= base_revision),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, request_id)
);

alter table public.game_accounts enable row level security;
alter table public.game_items enable row level security;
alter table public.game_requests enable row level security;
revoke all on public.game_accounts, public.game_items, public.game_requests from anon, authenticated;
grant all on public.game_accounts, public.game_items, public.game_requests to service_role;

create function public.online_db_now()
returns timestamptz language sql security definer set search_path = pg_catalog, public
as $$ select clock_timestamp() $$;

create function public.read_game_account(p_user_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public
as $$
  select to_jsonb(account) || jsonb_build_object('inventory', coalesce(items.inventory, '[]'::jsonb))
  from public.game_accounts as account
  left join lateral (
    select jsonb_agg(item order by item_id) as inventory from public.game_items where user_id = account.user_id
  ) as items on true
  where account.user_id = p_user_id
$$;

create function public.bootstrap_game_account(
  p_user_id uuid, p_rules_id text, p_state jsonb, p_gold bigint, p_tickets bigint,
  p_checkpoint_at timestamptz, p_remainder_ms double precision, p_active_until timestamptz, p_items jsonb
)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare inserted_user uuid;
begin
  if p_state ? 'gold' or p_state ? 'tickets' or p_state ? 'inventory' then raise exception 'invalid_account_state'; end if;
  if jsonb_typeof(p_items) <> 'array' or p_gold < 0 or p_tickets < 0 or p_remainder_ms < 0 or p_remainder_ms >= 50 then raise exception 'invalid_account_aggregate'; end if;
  insert into public.game_accounts(user_id, revision, rules_id, state, gold, tickets, checkpoint_at, remainder_ms, active_until)
  values (p_user_id, 0, p_rules_id, p_state, p_gold, p_tickets, p_checkpoint_at, p_remainder_ms, p_active_until)
  on conflict (user_id) do nothing returning user_id into inserted_user;
  if inserted_user is null then return false; end if;
  insert into public.game_items(user_id, item_id, item, slot, rarity)
  select p_user_id, value->>'id', value, value->>'slot', value->>'rarity' from jsonb_array_elements(p_items) as value;
  return true;
end
$$;

create function public.commit_game_operation(
  p_user_id uuid, p_request_id text, p_payload_hash text, p_kind text, p_expected_revision bigint,
  p_rules_id text, p_state jsonb, p_gold bigint, p_tickets bigint, p_checkpoint_at timestamptz,
  p_remainder_ms double precision, p_active_until timestamptz, p_paused boolean, p_items jsonb, p_result jsonb
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions
as $$
declare
  account public.game_accounts%rowtype;
  prior public.game_requests%rowtype;
  final_result jsonb;
  result_status text;
  rate_retry_seconds integer;
begin
  if length(p_request_id) < 1 or length(p_request_id) > 120 or p_payload_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request'; end if;
  if p_kind not in ('sync', 'command') or jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_operation'; end if;
  if p_state ? 'gold' or p_state ? 'tickets' or p_state ? 'inventory' or p_gold < 0 or p_tickets < 0 or p_remainder_ms < 0 or p_remainder_ms >= 50 then raise exception 'invalid_account_aggregate'; end if;
  select * into account from public.game_accounts where user_id = p_user_id for update;
  if not found then raise exception 'account_missing'; end if;
  if p_kind = 'command' then
    select * into prior from public.game_requests where user_id = p_user_id and request_id = p_request_id;
    if found then
      if prior.payload_hash <> p_payload_hash then return jsonb_build_object('error', 'request_conflict'); end if;
      return prior.result;
    end if;
  end if;
  if account.revision <> p_expected_revision then return jsonb_build_object('error', 'stale_revision', 'revision', account.revision); end if;
  if account.rules_id <> p_rules_id then return jsonb_build_object('error', 'rules_mismatch'); end if;
  if p_checkpoint_at < account.checkpoint_at then return jsonb_build_object('error', 'clock_rollback', 'revision', account.revision); end if;
  if p_kind = 'command' then
    if account.command_window_at is null or account.command_window_at <= clock_timestamp() - interval '1 hour' then
      update public.game_accounts set command_window_at = clock_timestamp(), command_count = 1 where user_id = p_user_id;
    elsif account.command_count >= 60 then
      rate_retry_seconds := greatest(1, ceil(extract(epoch from account.command_window_at + interval '1 hour' - clock_timestamp()))::integer);
      return jsonb_build_object('error', 'rate_limited', 'retryAfterSeconds', rate_retry_seconds);
    else
      update public.game_accounts set command_count = command_count + 1 where user_id = p_user_id;
    end if;
  end if;

  if p_kind = 'command' and coalesce((p_result->>'accepted')::boolean, true) = false then
    final_result := (p_result - 'state') || jsonb_build_object('revision', p_expected_revision + 1);
  else
    final_result := p_result || jsonb_build_object('revision', p_expected_revision + 1);
  end if;
  result_status := case when coalesce((p_result->>'accepted')::boolean, true) then 'complete' else 'rejected' end;
  update public.game_accounts set revision = revision + 1, state = p_state, gold = p_gold, tickets = p_tickets,
    checkpoint_at = p_checkpoint_at, remainder_ms = p_remainder_ms, active_until = p_active_until,
    paused = p_paused, updated_at = clock_timestamp() where user_id = p_user_id;
  delete from public.game_items where user_id = p_user_id;
  insert into public.game_items(user_id, item_id, item, slot, rarity)
  select p_user_id, value->>'id', value, value->>'slot', value->>'rarity' from jsonb_array_elements(p_items) as value;
  if p_kind = 'command' then
    insert into public.game_requests(user_id, request_id, payload_hash, kind, status, base_revision, result_revision, result)
    values (p_user_id, p_request_id, p_payload_hash, p_kind, result_status, p_expected_revision, p_expected_revision + 1, final_result);
  end if;
  return final_result;
end
$$;

revoke all on function public.online_db_now() from public, anon, authenticated;
revoke all on function public.read_game_account(uuid) from public, anon, authenticated;
revoke all on function public.bootstrap_game_account(uuid, text, jsonb, bigint, bigint, timestamptz, double precision, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.commit_game_operation(uuid, text, text, text, bigint, text, jsonb, bigint, bigint, timestamptz, double precision, timestamptz, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.online_db_now() to service_role;
grant execute on function public.read_game_account(uuid) to service_role;
grant execute on function public.bootstrap_game_account(uuid, text, jsonb, bigint, bigint, timestamptz, double precision, timestamptz, jsonb) to service_role;
grant execute on function public.commit_game_operation(uuid, text, text, text, bigint, text, jsonb, bigint, bigint, timestamptz, double precision, timestamptz, boolean, jsonb, jsonb) to service_role;
