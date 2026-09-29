-- PepDay V3.0 / Bloco D — direitos do titular: exportação self-service.
-- Exclusão da conta é executada por Edge Function autenticada para poder remover auth.users.
begin;

create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
  result jsonb;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;

  if not exists(select 1 from public.profiles where id=u) then
    raise exception 'Conta não inicializada';
  end if;

  result:=jsonb_build_object(
    'export_version','pepday-data-export-v1',
    'generated_at',stamp,
    'profile',(
      select to_jsonb(p) - 'role'
      from public.profiles p
      where p.id=u
    ),
    'settings',(
      select to_jsonb(s) - 'id' - 'user_id'
      from public.settings s
      where s.user_id=u
    ),
    'subscription',(
      select jsonb_build_object(
        'status',s.status,
        'plan',s.plan,
        'provider',s.provider,
        'provider_subscription_id',s.provider_subscription_id,
        'provider_plan_id',s.provider_plan_id,
        'billing_status',s.billing_status,
        'provider_status',s.provider_status,
        'last_payment_status',s.last_payment_status,
        'started_at',s.started_at,
        'current_period_start',s.current_period_start,
        'current_period_end',s.current_period_end,
        'grace_until',s.grace_until,
        'cancel_at_period_end',s.cancel_at_period_end,
        'cancelled_at',s.cancelled_at,
        'next_plan',s.next_plan,
        'created_at',s.created_at,
        'updated_at',s.updated_at
      )
      from public.subscriptions s
      where s.user_id=u
    ),
    'trial',(
      select jsonb_build_object(
        'trial_used',t.trial_used,
        'started_at',t.started_at,
        'ends_at',t.ends_at,
        'completed_at',t.completed_at,
        'created_at',t.created_at,
        'updated_at',t.updated_at
      )
      from public.trials t
      where t.user_id=u
    ),
    'vials',coalesce((
      select jsonb_agg(to_jsonb(v) - 'user_id' order by v.created_at,v.id)
      from public.vials v
      where v.user_id=u
    ),'[]'::jsonb),
    'routines',coalesce((
      select jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at,r.id)
      from public.routines r
      where r.user_id=u
    ),'[]'::jsonb),
    'routine_versions',coalesce((
      select jsonb_agg(to_jsonb(rv) - 'user_id' order by rv.created_at,rv.id)
      from public.routine_versions rv
      where rv.user_id=u
    ),'[]'::jsonb),
    'applications',coalesce((
      select jsonb_agg(to_jsonb(a) - 'user_id' order by a.created_at,a.id)
      from public.applications a
      where a.user_id=u
    ),'[]'::jsonb),
    'vial_movements',coalesce((
      select jsonb_agg(to_jsonb(vm) - 'user_id' order by vm.created_at,vm.id)
      from public.vial_movements vm
      where vm.user_id=u
    ),'[]'::jsonb),
    'imports',coalesce((
      select jsonb_agg(to_jsonb(i) - 'user_id' order by i.created_at,i.id)
      from public.local_data_imports i
      where i.user_id=u
    ),'[]'::jsonb),
    'acquisition',(
      select jsonb_build_object(
        'source',a.source,
        'medium',a.medium,
        'campaign',a.campaign,
        'landing_path',a.landing_path,
        'first_seen_at',a.first_seen_at,
        'attributed_at',a.attributed_at
      )
      from public.acquisition_attributions a
      where a.user_id=u
    )
  );

  insert into public.audit_logs(user_id,action)
  values(u,'data_exported');

  return result;
end $$;

revoke all on function public.export_my_data()
  from public,anon,authenticated;
grant execute on function public.export_my_data()
  to authenticated;

commit;
