-- Sessão A: adquire explicitamente FOR UPDATE e segura o lock por 20 s.
begin;
set local statement_timeout='60s';
select set_config('pepday.b2.outcome','FAIL',true);
do $$ declare locked_id uuid; begin
  select id into locked_id from public.vials
  where user_id='f2600000-0000-4000-8000-000000000001'
    and id='e2620000-0000-4000-8000-000000000002' for update;
  if locked_id is not null then perform set_config('pepday.b2.outcome','PASS',true); end if;
exception when others then
  perform set_config('pepday.b2.outcome','FAIL',true);
end $$;
select set_config('pepday.b2.acquired_at',clock_timestamp()::text,true);
insert into public.audit_logs(user_id,action,operation_id,created_at) values (
  'f2600000-0000-4000-8000-000000000001',
  case when current_setting('pepday.b2.outcome')='PASS' then 'b2c_s2_a_acquired_pass' else 'b2c_s2_a_acquired_fail' end,
  'a1620000-0000-4000-8000-000000000001',current_setting('pepday.b2.acquired_at')::timestamptz);
select pg_sleep(case when current_setting('pepday.b2.outcome')='PASS' then 20 else 0 end);
insert into public.audit_logs(user_id,action,operation_id,created_at) values (
  'f2600000-0000-4000-8000-000000000001',
  case when current_setting('pepday.b2.outcome')='PASS' then 'b2c_s2_a_releasing_pass' else 'b2c_s2_a_releasing_fail' end,
  'a1620000-0000-4000-8000-000000000002',clock_timestamp());
commit;
