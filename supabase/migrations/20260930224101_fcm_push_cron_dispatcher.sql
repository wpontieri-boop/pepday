-- PepDay V3.0 / Bloco C — dispatcher periódico seguro do worker FCM.
-- O cron não armazena segredo estático: cada chamada recebe token curto, aleatório e de uso único.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.push_worker_invocations (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash)=32),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);

create index push_worker_invocations_expiry_idx
  on public.push_worker_invocations(expires_at)
  where consumed_at is null;

alter table public.push_worker_invocations enable row level security;
revoke all on public.push_worker_invocations
  from public,anon,authenticated,service_role;

create or replace function public.consume_push_worker_invocation(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  value text:=lower(trim(coalesce(p_token,'')));
  stamp timestamptz:=statement_timestamp();
  changed integer:=0;
begin
  if value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('outcome','rejected');
  end if;

  update public.push_worker_invocations
  set consumed_at=stamp
  where token_hash=extensions.digest(value,'sha256')
    and consumed_at is null
    and expires_at>stamp;
  get diagnostics changed=row_count;

  return jsonb_build_object(
    'outcome',case when changed=1 then 'accepted' else 'rejected' end
  );
end $$;

revoke all on function public.consume_push_worker_invocation(text)
  from public,anon,authenticated,service_role;
grant execute on function public.consume_push_worker_invocation(text)
  to service_role;

create or replace function public.dispatch_fcm_push_worker()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  stamp timestamptz:=statement_timestamp();
  invocation_token uuid:=gen_random_uuid();
  base_url text;
  request_id bigint;
  ready boolean:=false;
begin
  select exists(
    select 1
    from public.push_notification_outbox
    where attempts<5
      and (
        (status in ('pending','retry') and available_at<=stamp)
        or
        (status='processing' and locked_at<stamp-interval '15 minutes')
      )
  ) into ready;

  if ready is not true then
    return jsonb_build_object('outcome','idle');
  end if;

  select decrypted_secret into base_url
  from vault.decrypted_secrets
  where name='pepday_supabase_project_url'
  order by created_at desc
  limit 1;

  base_url:=rtrim(coalesce(base_url,''),'/');
  if base_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    return jsonb_build_object('outcome','config_missing');
  end if;
  delete from public.push_worker_invocations
  where expires_at<stamp-interval '1 day';

  insert into public.push_worker_invocations(token_hash,expires_at)
  values(
    extensions.digest(lower(invocation_token::text),'sha256'),
    stamp+interval '2 minutes'
  );

  select net.http_post(
    url:=base_url||'/functions/v1/fcm-push-worker',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-pepday-invocation-token',invocation_token::text
    ),
    body:=jsonb_build_object('source','pg_cron'),
    timeout_milliseconds:=5000
  ) into request_id;

  return jsonb_build_object('outcome','requested','request_id',request_id);
end $$;

revoke all on function public.dispatch_fcm_push_worker()
  from public,anon,authenticated,service_role;
select cron.schedule(
  'pepday-fcm-push-worker',
  '* * * * *',
  'select public.dispatch_fcm_push_worker();'
);

commit;
