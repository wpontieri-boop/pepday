begin;
set local role authenticated;
set local statement_timeout='60s';
select set_config('request.jwt.claim.sub','f2600000-0000-4000-8000-000000000001',true);
select set_config('pepday.b2.started_at',clock_timestamp()::text,true);
select set_config('pepday.b2.same_day_result','FAIL — segunda operação foi aceita',true);
do $$ begin
  perform public.register_application(
    'b2630000-0000-4000-8000-000000000002',auth.uid(),
    'd2630000-0000-4000-8000-000000000001','c2630000-0000-4000-8000-000000000001',
    'e2630000-0000-4000-8000-000000000003',current_date,null);
exception when others then
  if sqlstate='23505' or sqlerrm like '%Já existe aplicação ativa%' then
    perform set_config('pepday.b2.same_day_result','PASS — segunda operação bloqueada',true);
  else
    perform set_config('pepday.b2.same_day_result',format('FAIL [%s]: %s',sqlstate,sqlerrm),true);
  end if;
end $$;
select current_setting('pepday.b2.same_day_result') as resultado,
  clock_timestamp()-current_setting('pepday.b2.started_at')::timestamptz as espera_observada;
commit;
