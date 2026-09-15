begin;
set local role authenticated;
set local statement_timeout='60s';
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select public.register_application(
  'b2630000-0000-4000-8000-000000000001',auth.uid(),
  'd2630000-0000-4000-8000-000000000001','c2630000-0000-4000-8000-000000000001',
  'e2630000-0000-4000-8000-000000000003',current_date,null) as aplicacao_a;
select pg_sleep(20);
commit;
