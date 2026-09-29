-- PepDay V3.0 / Bloco C — aceita pagamento aprovado que estende o período mesmo se webhook chegar fora de ordem.
begin;

create or replace function public.apply_billing_event(
  p_provider_event_id text,
  p_event_type text,
  p_action text,
  p_provider_resource_id text,
  p_subscription_id uuid,
  p_effect text,
  p_provider_event_at timestamptz,
  p_provider_subscription_id text default null,
  p_provider_plan_id text default null,
  p_plan text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  s public.subscriptions;
  e_id uuid;
  stamp timestamptz:=statement_timestamp();
  next_grace timestamptz;
begin
  if p_provider_event_id is null or length(trim(p_provider_event_id))=0
     or p_action is null or length(trim(p_action))=0
     or p_provider_resource_id is null or length(trim(p_provider_resource_id))=0
     or p_provider_event_at is null then
    raise exception 'Evento de billing invÃ¡lido';
  end if;

  if p_event_type not in ('subscription_preapproval','subscription_authorized_payment','payment') then
    raise exception 'Tipo de evento de billing invÃ¡lido';
  end if;

  if p_effect not in (
    'payment_approved','payment_pending','payment_rejected','renewal_failed',
    'subscription_canceled','subscription_reactivated','subscription_paused',
    'subscription_expired'
  ) then
    raise exception 'Efeito de billing invÃ¡lido';
  end if;

  if p_plan is not null and p_plan not in ('monthly','annual') then
    raise exception 'Plano de billing invÃ¡lido';
  end if;

  select * into s from public.subscriptions where id=p_subscription_id for update;
  if s.id is null then raise exception 'Assinatura PepDay nÃ£o encontrada'; end if;

  insert into public.billing_events(
    provider_event_id,event_type,action,provider_resource_id,subscription_id,effect,provider_event_at
  ) values (
    trim(p_provider_event_id),p_event_type,trim(p_action),trim(p_provider_resource_id),
    s.id,p_effect,p_provider_event_at
  )
  on conflict(provider,event_type,provider_event_id) do nothing
  returning id into e_id;

  if e_id is null then
    return jsonb_build_object('outcome','duplicate','subscription_id',s.id,'billing_version',s.billing_version);
  end if;

  if p_effect='payment_approved' then
    if p_period_end is not null
       and s.current_period_end is not null
       and p_period_end<=s.current_period_end then
      update public.billing_events set outcome='stale',processed_at=stamp where id=e_id;
      return jsonb_build_object('outcome','stale','subscription_id',s.id,'billing_version',s.billing_version);
    end if;
  elsif s.last_provider_event_at is not null and p_provider_event_at<s.last_provider_event_at then
    update public.billing_events set outcome='stale',processed_at=stamp where id=e_id;
    return jsonb_build_object('outcome','stale','subscription_id',s.id,'billing_version',s.billing_version);
  end if;

  if p_effect='payment_approved' then
    if p_plan not in ('monthly','annual')
       or p_provider_subscription_id is null
       or p_period_start is null or p_period_end is null or p_period_end<=p_period_start then
      update public.billing_events set outcome='failed',processed_at=stamp,error_code='INVALID_APPROVED_PAYMENT' where id=e_id;
      raise exception 'Pagamento aprovado sem perÃ­odo/plano vÃ¡lidos';
    end if;

    update public.subscriptions set
      status='pro_active',
      plan=p_plan,
      provider='mercado_pago',
      provider_subscription_id=p_provider_subscription_id,
      provider_plan_id=p_provider_plan_id,
      provider_status='authorized',
      billing_status='active',
      last_payment_status='approved',
      started_at=coalesce(started_at,p_period_start),
      current_period_start=p_period_start,
      current_period_end=p_period_end,
      grace_until=null,
      cancel_at_period_end=false,
      cancelled_at=null,
      next_plan=null,
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;

  elsif p_effect='payment_pending' then
    update public.subscriptions set
      provider='mercado_pago',
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_plan_id=coalesce(p_provider_plan_id,provider_plan_id),
      provider_status='pending',
      billing_status=case when status='pro_active' then billing_status else 'pending' end,
      last_payment_status='pending',
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;

  elsif p_effect='payment_rejected' then
    update public.subscriptions set
      provider='mercado_pago',
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_plan_id=coalesce(p_provider_plan_id,provider_plan_id),
      last_payment_status='rejected',
      billing_status=case when status='pro_active' then billing_status else 'pending' end,
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;

  elsif p_effect='renewal_failed' then
    if s.started_at is null or s.plan not in ('monthly','annual') then
      update public.billing_events set outcome='failed',processed_at=stamp,error_code='NO_ACTIVE_SUBSCRIPTION' where id=e_id;
      raise exception 'Falha de renovaÃ§Ã£o sem assinatura paga anterior';
    end if;
    next_grace:=p_provider_event_at+interval '3 days';
    update public.subscriptions set
      status='pro_active',
      provider='mercado_pago',
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_plan_id=coalesce(p_provider_plan_id,provider_plan_id),
      last_payment_status='rejected',
      billing_status='grace',
      grace_until=greatest(coalesce(grace_until,'-infinity'::timestamptz),next_grace),
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;

  elsif p_effect='subscription_canceled' then
    update public.subscriptions set
      provider='mercado_pago',
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_plan_id=coalesce(p_provider_plan_id,provider_plan_id),
      provider_status='canceled',
      billing_status='canceled',
      cancel_at_period_end=true,
      cancelled_at=coalesce(cancelled_at,p_provider_event_at),
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;

  elsif p_effect='subscription_reactivated' then
    update public.subscriptions set
      provider='mercado_pago',
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_plan_id=coalesce(p_provider_plan_id,provider_plan_id),
      provider_status='authorized',
      billing_status=case
        when greatest(coalesce(current_period_end,'-infinity'::timestamptz),coalesce(grace_until,'-infinity'::timestamptz))>p_provider_event_at
          then 'active'
        else 'expired'
      end,
      status=case
        when greatest(coalesce(current_period_end,'-infinity'::timestamptz),coalesce(grace_until,'-infinity'::timestamptz))>p_provider_event_at
          then 'pro_active'
        else 'pro_expired'
      end,
      cancel_at_period_end=false,
      cancelled_at=null,
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;

  elsif p_effect='subscription_paused' then
    update public.subscriptions set
      provider='mercado_pago',
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_plan_id=coalesce(p_provider_plan_id,provider_plan_id),
      provider_status='paused',
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;

  elsif p_effect='subscription_expired' then
    update public.subscriptions set
      status='pro_expired',
      provider='mercado_pago',
      provider_subscription_id=coalesce(p_provider_subscription_id,provider_subscription_id),
      provider_plan_id=coalesce(p_provider_plan_id,provider_plan_id),
      billing_status='expired',
      grace_until=null,
      last_provider_event_at=p_provider_event_at,
      billing_version=billing_version+1,
      updated_at=stamp
    where id=s.id;
  end if;

  update public.billing_events set outcome='applied',processed_at=stamp where id=e_id;
  insert into public.audit_logs(user_id,action)
    values(s.user_id,'billing_'||p_effect);

  select * into s from public.subscriptions where id=p_subscription_id;
  return jsonb_build_object(
    'outcome','applied',
    'subscription_id',s.id,
    'status',s.status,
    'plan',s.plan,
    'billing_status',s.billing_status,
    'billing_version',s.billing_version,
    'current_period_end',s.current_period_end,
    'grace_until',s.grace_until,
    'cancel_at_period_end',s.cancel_at_period_end
  );
end $$;

revoke all on function public.apply_billing_event(
  text,text,text,text,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz
) from public,anon,authenticated;
grant execute on function public.apply_billing_event(
  text,text,text,text,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz
) to service_role;

commit;
