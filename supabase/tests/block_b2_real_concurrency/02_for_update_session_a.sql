begin;
set local statement_timeout='60s';
select id,remaining_mg from public.vials
where user_id='f2600000-0000-4000-8000-000000000001'
  and id='e2620000-0000-4000-8000-000000000002'
for update;
select pg_sleep(20);
commit;
