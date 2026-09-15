-- Sessão B: deve iniciar durante a janela de A e aguardar pelo menos 8 s.
begin;
set local role authenticated;
set local statement_timeout='60s';
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('pepday.b2.started_at',clock_timestamp()::text,true);
select set_config('pepday.b2.outcome','FAIL',true);
do $$ begin
  perform public.register_application(
    'b2610000-0000-4000-8000-000000000002',auth.uid(),
    'd2610000-0000-4000-8000-000000000002','c2610000-0000-4000-8000-000000000002',
    'e2610000-0000-4000-8000-000000000001',current_date,null);
  perform set_config('pepday.b2.outcome','PASS',true);
exception when others then
  perform set_config('pepday.b2.outcome','FAIL',true);
end $$;
select set_config('pepday.b2.finished_at',clock_timestamp()::text,true);
reset role;
insert into public.audit_logs(user_id,action,operation_id,created_at) values
  ('f2600000-0000-4000-8000-000000000001','b2c_s1_b_started',
    'b1610000-0000-4000-8000-000000000001',current_setting('pepday.b2.started_at')::timestamptz),
  ('f2600000-0000-4000-8000-000000000001',
    case when current_setting('pepday.b2.outcome')='PASS'
      and current_setting('pepday.b2.finished_at')::timestamptz-current_setting('pepday.b2.started_at')::timestamptz>=interval '8 seconds'
      then 'b2c_s1_b_finished_pass' else 'b2c_s1_b_finished_fail' end,
    'b1610000-0000-4000-8000-000000000002',current_setting('pepday.b2.finished_at')::timestamptz);
commit;
