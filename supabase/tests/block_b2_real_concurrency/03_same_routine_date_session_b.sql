-- Sessão B deve aguardar A e ser recusada pelo conflito esperado.
begin;
set local role authenticated;
set local statement_timeout='60s';
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('pepday.b2.started_at',clock_timestamp()::text,true);
select set_config('pepday.b2.outcome','UNEXPECTED_ACCEPT',true);
do $$ begin
  perform public.register_application(
    'b2630000-0000-4000-8000-000000000002',auth.uid(),
    'd2630000-0000-4000-8000-000000000001','c2630000-0000-4000-8000-000000000001',
    'e2630000-0000-4000-8000-000000000003',current_date,null);
exception when others then
  if sqlstate='23505' or sqlerrm like '%Já existe aplicação ativa%' then
    perform set_config('pepday.b2.outcome','BLOCKED_EXPECTED',true);
  else
    perform set_config('pepday.b2.outcome','UNEXPECTED_ERROR',true);
  end if;
end $$;
select set_config('pepday.b2.finished_at',clock_timestamp()::text,true);
reset role;
insert into public.audit_logs(user_id,action,operation_id,created_at) values
  ('f2600000-0000-4000-8000-000000000001','b2c_s3_b_started',
    'b1630000-0000-4000-8000-000000000001',current_setting('pepday.b2.started_at')::timestamptz),
  ('f2600000-0000-4000-8000-000000000001',
    case when current_setting('pepday.b2.outcome')='BLOCKED_EXPECTED'
      and current_setting('pepday.b2.finished_at')::timestamptz-current_setting('pepday.b2.started_at')::timestamptz>=interval '8 seconds'
      then 'b2c_s3_b_finished_blocked_pass'
      else 'b2c_s3_b_finished_fail_'||lower(current_setting('pepday.b2.outcome')) end,
    'b1630000-0000-4000-8000-000000000002',current_setting('pepday.b2.finished_at')::timestamptz);
commit;
