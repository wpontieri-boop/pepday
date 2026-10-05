-- Somente TEST; copiar para PROD exige novo desenho e autorização expressa.
begin;
create function public.dispatch_recovery_test_worker(p_action text default 'run') returns jsonb
language plpgsql security definer set search_path='' as $$
declare base_url text;token uuid:=gen_random_uuid();request_id bigint;
begin
  if p_action not in ('run','setup') then raise exception 'Ação inválida';end if;
  select decrypted_secret into base_url from vault.decrypted_secrets where name='pepday_supabase_project_url' order by created_at desc limit 1;
  if rtrim(coalesce(base_url,''),'/')<>'https://fsbqpyyprtymwrmzsacp.supabase.co' then return jsonb_build_object('outcome','test_only');end if;
  if p_action='run' and not (select enabled from public.recovery_config) then return jsonb_build_object('outcome','disabled');end if;
  delete from public.recovery_worker_invocations where expires_at<statement_timestamp()-interval '1 day';
  insert into public.recovery_worker_invocations values(extensions.digest(token::text,'sha256'),statement_timestamp()+interval '2 minutes',null);
  select net.http_post(url:=rtrim(base_url,'/')||'/functions/v1/recovery-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-pepday-invocation-token',token::text),
    body:=jsonb_build_object('action',p_action),timeout_milliseconds:=60000) into request_id;
  return jsonb_build_object('outcome','requested','request_id',request_id);
end $$;
revoke all on function public.dispatch_recovery_test_worker(text) from public,anon,authenticated,service_role;
-- Cron runs as database owner. No reusable secret or token leaves the database.
select cron.schedule('pepday-recovery-test-worker','*/5 * * * *','select public.dispatch_recovery_test_worker();');
commit;
