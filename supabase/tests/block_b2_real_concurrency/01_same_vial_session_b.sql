begin;
set local role authenticated;
set local statement_timeout='60s';
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('pepday.b2.started_at',clock_timestamp()::text,true);
select public.register_application(
  'b2610000-0000-4000-8000-000000000002',auth.uid(),
  'd2610000-0000-4000-8000-000000000002','c2610000-0000-4000-8000-000000000002',
  'e2610000-0000-4000-8000-000000000001',current_date,null) as aplicacao_b;
select clock_timestamp()-current_setting('pepday.b2.started_at')::timestamptz as espera_observada;
commit;
