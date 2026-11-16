begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(not has_table_privilege('anon', 'public.game_accounts', 'select'), 'anon cannot read account rows');
select ok(not has_table_privilege('authenticated', 'public.game_items', 'select'), 'authenticated cannot read normalized inventory directly');
select ok(not has_table_privilege('authenticated', 'public.game_accounts', 'update'), 'authenticated cannot write account aggregates');
select ok(not has_function_privilege('anon', 'public.read_game_account(uuid)', 'execute'), 'anon cannot execute the account read RPC');
select ok(not has_function_privilege('authenticated', 'public.read_game_account(uuid)', 'execute'), 'authenticated cannot execute the account read RPC');
select ok(not has_function_privilege('authenticated', 'public.commit_game_operation(uuid,text,text,text,bigint,text,jsonb,bigint,bigint,timestamptz,double precision,timestamptz,boolean,jsonb,jsonb)', 'execute'), 'authenticated cannot execute economic commits');
select ok(has_function_privilege('service_role', 'public.commit_game_operation(uuid,text,text,text,bigint,text,jsonb,bigint,bigint,timestamptz,double precision,timestamptz,boolean,jsonb,jsonb)', 'execute'), 'server service role can execute atomic economic commits');
select ok(to_regclass('public.game_jobs') is null, 'bounded inline operations do not create placeholder job rows');

select * from finish();
rollback;
