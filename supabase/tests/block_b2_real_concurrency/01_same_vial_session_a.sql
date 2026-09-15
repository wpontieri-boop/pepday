-- Sessão A: cria a primeira aplicação, mantém o lock por 20 s e registra evidência.
begin;
set local role authenticated;
set local statement_timeout='60s';
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('pepday.b2.outcome','FAIL',true);
do $$ begin
  perform public.register_application(
    'b2610000-0000-4000-8000-000000000001',auth.uid(),
    'd2610000-0000-4000-8000-000000000001','c2610000-0000-4000-8000-000000000001',
    'e2610000-0000-4000-8000-000000000001',current_date,null);
  perform set_config('pepday.b2.outcome','PASS',true);
exception when others then
  perform set_config('pepday.b2.outcome','FAIL',true);
end $$;
select set_config('pepday.b2.acquired_at',clock_timestamp()::text,true);
reset role;
insert into public.audit_logs(user_id,action,operation_id,created_at) values (
  'f2600000-0000-4000-8000-000000000001',
  case when current_setting('pepday.b2.outcome')='PASS' then 'b2c_s1_a_acquired_pass' else 'b2c_s1_a_acquired_fail' end,
  'a1610000-0000-4000-8000-000000000001',current_setting('pepday.b2.acquired_at')::timestamptz);
select pg_sleep(case when current_setting('pepday.b2.outcome')='PASS' then 20 else 0 end);
insert into public.audit_logs(user_id,action,operation_id,created_at) values (
  'f2600000-0000-4000-8000-000000000001',
  case when current_setting('pepday.b2.outcome')='PASS' then 'b2c_s1_a_releasing_pass' else 'b2c_s1_a_releasing_fail' end,
  'a1610000-0000-4000-8000-000000000002',clock_timestamp());
commit;
