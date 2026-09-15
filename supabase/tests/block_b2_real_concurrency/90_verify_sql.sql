with checks as (
  select '1 — mesmo frasco'::text as cenario,
    (select remaining_mg=8 from public.vials where id='e2610000-0000-4000-8000-000000000001')
    and (select count(*)=2 from public.applications where user_id='f2600000-0000-4000-8000-000000000001' and operation_id in (
      'b2610000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000002'))
    and (select count(*)=2 from public.vial_movements where user_id='f2600000-0000-4000-8000-000000000001' and operation_id in (
      'b2610000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000002'))
    and exists(select 1 from public.applications where operation_id='b2610000-0000-4000-8000-000000000001' and balance_before=10 and balance_after=9)
    and exists(select 1 from public.applications where operation_id='b2610000-0000-4000-8000-000000000002' and balance_before=9 and balance_after=8) as passed
  union all
  select '2 — FOR UPDATE',
    (select remaining_mg=9 from public.vials where id='e2620000-0000-4000-8000-000000000002')
    and (select count(*)=1 from public.applications where operation_id='b2620000-0000-4000-8000-000000000001')
    and (select count(*)=1 from public.vial_movements where operation_id='b2620000-0000-4000-8000-000000000001')
  union all
  select '3 — mesma rotina/data',
    (select remaining_mg=9 from public.vials where id='e2630000-0000-4000-8000-000000000003')
    and (select count(*)=1 from public.applications where user_id='f2600000-0000-4000-8000-000000000001' and routine_id='d2630000-0000-4000-8000-000000000001' and scheduled_date=current_date and undone_at is null)
    and (select count(*)=1 from public.vial_movements where user_id='f2600000-0000-4000-8000-000000000001' and operation_id in (
      'b2630000-0000-4000-8000-000000000001','b2630000-0000-4000-8000-000000000002'))
)
select cenario,case when passed then 'PASS' else 'FAIL' end as resultado from checks order by cenario;
