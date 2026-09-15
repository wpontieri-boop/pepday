-- PASS exige estado correto e quatro evidências (A/B) com sobreposição >= 8 s.
with timeline as (
  select
    max(created_at) filter(where operation_id='a1610000-0000-4000-8000-000000000001' and action='b2c_s1_a_acquired_pass') s1_a_acquired,
    max(created_at) filter(where operation_id='a1610000-0000-4000-8000-000000000002' and action='b2c_s1_a_releasing_pass') s1_a_releasing,
    max(created_at) filter(where operation_id='b1610000-0000-4000-8000-000000000001' and action='b2c_s1_b_started') s1_b_started,
    max(created_at) filter(where operation_id='b1610000-0000-4000-8000-000000000002' and action='b2c_s1_b_finished_pass') s1_b_finished,
    count(*) filter(where operation_id in ('a1610000-0000-4000-8000-000000000001','a1610000-0000-4000-8000-000000000002','b1610000-0000-4000-8000-000000000001','b1610000-0000-4000-8000-000000000002')) s1_evidence,
    max(created_at) filter(where operation_id='a1620000-0000-4000-8000-000000000001' and action='b2c_s2_a_acquired_pass') s2_a_acquired,
    max(created_at) filter(where operation_id='a1620000-0000-4000-8000-000000000002' and action='b2c_s2_a_releasing_pass') s2_a_releasing,
    max(created_at) filter(where operation_id='b1620000-0000-4000-8000-000000000001' and action='b2c_s2_b_started') s2_b_started,
    max(created_at) filter(where operation_id='b1620000-0000-4000-8000-000000000002' and action='b2c_s2_b_finished_pass') s2_b_finished,
    count(*) filter(where operation_id in ('a1620000-0000-4000-8000-000000000001','a1620000-0000-4000-8000-000000000002','b1620000-0000-4000-8000-000000000001','b1620000-0000-4000-8000-000000000002')) s2_evidence,
    max(created_at) filter(where operation_id='a1630000-0000-4000-8000-000000000001' and action='b2c_s3_a_acquired_pass') s3_a_acquired,
    max(created_at) filter(where operation_id='a1630000-0000-4000-8000-000000000002' and action='b2c_s3_a_releasing_pass') s3_a_releasing,
    max(created_at) filter(where operation_id='b1630000-0000-4000-8000-000000000001' and action='b2c_s3_b_started') s3_b_started,
    max(created_at) filter(where operation_id='b1630000-0000-4000-8000-000000000002' and action='b2c_s3_b_finished_blocked_pass') s3_b_finished,
    count(*) filter(where operation_id in ('a1630000-0000-4000-8000-000000000001','a1630000-0000-4000-8000-000000000002','b1630000-0000-4000-8000-000000000001','b1630000-0000-4000-8000-000000000002')) s3_evidence
  from public.audit_logs where user_id='f2600000-0000-4000-8000-000000000001'
), checks as (
  select '1 — mesmo frasco'::text cenario,
    s1_evidence=4 and s1_a_acquired<s1_b_started and s1_b_started<s1_a_releasing
    and s1_b_finished>=s1_a_releasing and s1_b_finished-s1_b_started>=interval '8 seconds'
    and (select initial_mg=10 and remaining_mg=8 from public.vials where id='e2610000-0000-4000-8000-000000000001')
    and (select count(*)=2 from public.applications where vial_id='e2610000-0000-4000-8000-000000000001')
    and (select count(*)=2 from public.vial_movements where vial_id='e2610000-0000-4000-8000-000000000001')
    and exists(select 1 from public.applications a join public.vial_movements m on m.user_id=a.user_id and m.application_id=a.id
      where a.operation_id='b2610000-0000-4000-8000-000000000001' and m.operation_id=a.operation_id
        and a.balance_before=10 and a.balance_after=9 and m.kind='application' and m.delta_mg=-1 and m.balance_before=10 and m.balance_after=9)
    and exists(select 1 from public.applications a join public.vial_movements m on m.user_id=a.user_id and m.application_id=a.id
      where a.operation_id='b2610000-0000-4000-8000-000000000002' and m.operation_id=a.operation_id
        and a.balance_before=9 and a.balance_after=8 and m.kind='application' and m.delta_mg=-1 and m.balance_before=9 and m.balance_after=8) passed,
    extract(epoch from s1_b_finished-s1_b_started) wait_seconds from timeline
  union all
  select '2 — FOR UPDATE',
    s2_evidence=4 and s2_a_acquired<s2_b_started and s2_b_started<s2_a_releasing
    and s2_b_finished>=s2_a_releasing and s2_b_finished-s2_b_started>=interval '8 seconds'
    and (select initial_mg=10 and remaining_mg=9 from public.vials where id='e2620000-0000-4000-8000-000000000002')
    and (select count(*)=1 from public.applications where vial_id='e2620000-0000-4000-8000-000000000002')
    and (select count(*)=1 from public.vial_movements where vial_id='e2620000-0000-4000-8000-000000000002')
    and exists(select 1 from public.applications a join public.vial_movements m on m.user_id=a.user_id and m.application_id=a.id
      where a.operation_id='b2620000-0000-4000-8000-000000000001' and m.operation_id=a.operation_id
        and a.balance_before=10 and a.balance_after=9 and m.kind='application' and m.delta_mg=-1 and m.balance_before=10 and m.balance_after=9),
    extract(epoch from s2_b_finished-s2_b_started) from timeline
  union all
  select '3 — mesma rotina/data',
    s3_evidence=4 and s3_a_acquired<s3_b_started and s3_b_started<s3_a_releasing
    and s3_b_finished>=s3_a_releasing and s3_b_finished-s3_b_started>=interval '8 seconds'
    and (select initial_mg=10 and remaining_mg=9 from public.vials where id='e2630000-0000-4000-8000-000000000003')
    and (select count(*)=1 from public.applications where vial_id='e2630000-0000-4000-8000-000000000003' and operation_id='b2630000-0000-4000-8000-000000000001' and undone_at is null)
    and not exists(select 1 from public.applications where operation_id='b2630000-0000-4000-8000-000000000002')
    and (select count(*)=1 from public.vial_movements where vial_id='e2630000-0000-4000-8000-000000000003')
    and not exists(select 1 from public.vial_movements where operation_id='b2630000-0000-4000-8000-000000000002')
    and exists(select 1 from public.applications a join public.vial_movements m on m.user_id=a.user_id and m.application_id=a.id
      where a.operation_id='b2630000-0000-4000-8000-000000000001' and m.operation_id=a.operation_id
        and a.balance_before=10 and a.balance_after=9 and m.kind='application' and m.delta_mg=-1 and m.balance_before=10 and m.balance_after=9),
    extract(epoch from s3_b_finished-s3_b_started) from timeline
)
select cenario,coalesce(round(wait_seconds::numeric,3),0) wait_seconds,
  case when coalesce(passed,false) then 'PASS' else 'FAIL' end resultado
from checks order by cenario;
