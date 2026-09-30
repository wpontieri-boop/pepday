-- PepDay V3.0 / Bloco C — roteia o cron para o dispatcher interno.
begin;

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
    url:=base_url||'/functions/v1/fcm-push-cron-dispatcher',
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

commit;
