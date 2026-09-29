-- PepDay V3.0 / Bloco C — expansão do painel administrativo para ciclo de vida e recuperação.
-- Somente métricas agregadas; contas administrativas não entram nos indicadores comerciais.
begin;

create or replace function public.get_admin_acquisition_metrics(
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
  window_start timestamptz;
  accounts_total bigint:=0;
  card_accounts bigint:=0;
  other_accounts bigint:=0;
  trials_started bigint:=0;
  card_trials bigint:=0;
  paid_conversions bigint:=0;
  card_paid_conversions bigint:=0;
  paid_active_now bigint:=0;
  total_users_now bigint:=0;
  free_now bigint:=0;
  trial_active_now bigint:=0;
  trial_ending_3d_now bigint:=0;
  trial_expired_no_pro_now bigint:=0;
  recovery_eligible_now bigint:=0;
  monthly_active_now bigint:=0;
  annual_active_now bigint:=0;
  grace_active_now bigint:=0;
  cancel_scheduled_now bigint:=0;
  pro_expired_now bigint:=0;
  cancellations_in_window bigint:=0;
  card_to_trial numeric:=0;
  card_to_paid numeric:=0;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id=u and role='admin'
  ) then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  if p_days is null or p_days not in (7,30,90) then
    raise exception 'Janela administrativa inválida';
  end if;

  window_start:=stamp-(p_days*interval '1 day');

  select count(*) into total_users_now
  from public.profiles p
  where p.role<>'admin';

  select count(*) into accounts_total
  from public.profiles p
  where p.role<>'admin'
    and p.created_at>=window_start and p.created_at<=stamp;

  select count(*) into card_accounts
  from public.profiles p
  where p.role<>'admin'
    and p.created_at>=window_start and p.created_at<=stamp
    and exists (
      select 1 from public.acquisition_attributions a
      where a.user_id=p.id and a.source='card' and a.medium='qr'
    );

  other_accounts:=greatest(accounts_total-card_accounts,0);

  select count(*) into trials_started
  from public.trials t
  join public.profiles p on p.id=t.user_id and p.role<>'admin'
  where t.started_at>=window_start and t.started_at<=stamp;

  select count(*) into card_trials
  from public.trials t
  join public.profiles p on p.id=t.user_id and p.role<>'admin'
  where t.started_at>=window_start and t.started_at<=stamp
    and exists (
      select 1 from public.acquisition_attributions a
      where a.user_id=t.user_id and a.source='card' and a.medium='qr'
    );

  select count(*) into paid_conversions
  from public.subscriptions s
  join public.profiles p on p.id=s.user_id and p.role<>'admin'
  where s.provider='mercado_pago'
    and s.started_at>=window_start and s.started_at<=stamp;

  select count(*) into card_paid_conversions
  from public.subscriptions s
  join public.profiles p on p.id=s.user_id and p.role<>'admin'
  where s.provider='mercado_pago'
    and s.started_at>=window_start and s.started_at<=stamp
    and exists (
      select 1 from public.acquisition_attributions a
      where a.user_id=s.user_id and a.source='card' and a.medium='qr'
    );

  select count(*) into paid_active_now
  from public.subscriptions s
  join public.profiles p on p.id=s.user_id and p.role<>'admin'
  where s.provider='mercado_pago'
    and s.status='pro_active'
    and greatest(
      coalesce(s.current_period_end,'-infinity'::timestamptz),
      coalesce(s.grace_until,'-infinity'::timestamptz)
    )>stamp;

  select count(*) into free_now
  from public.profiles p
  join public.trials t on t.user_id=p.id
  join public.subscriptions s on s.user_id=p.id
  where p.role<>'admin'
    and not t.trial_used
    and s.started_at is null;

  select count(*) into trial_active_now
  from public.profiles p
  join public.trials t on t.user_id=p.id
  join public.subscriptions s on s.user_id=p.id
  where p.role<>'admin'
    and t.trial_used and t.ends_at>stamp
    and not (
      s.provider='mercado_pago' and s.status='pro_active'
      and greatest(
        coalesce(s.current_period_end,'-infinity'::timestamptz),
        coalesce(s.grace_until,'-infinity'::timestamptz)
      )>stamp
    );

  select count(*) into trial_ending_3d_now
  from public.profiles p
  join public.trials t on t.user_id=p.id
  join public.subscriptions s on s.user_id=p.id
  where p.role<>'admin'
    and t.trial_used and t.ends_at>stamp and t.ends_at<=stamp+interval '3 days'
    and not (
      s.provider='mercado_pago' and s.status='pro_active'
      and greatest(
        coalesce(s.current_period_end,'-infinity'::timestamptz),
        coalesce(s.grace_until,'-infinity'::timestamptz)
      )>stamp
    );

  select count(*) into trial_expired_no_pro_now
  from public.profiles p
  join public.trials t on t.user_id=p.id
  join public.subscriptions s on s.user_id=p.id
  where p.role<>'admin'
    and t.trial_used and t.ends_at<=stamp
    and s.started_at is null;

  select count(*) into recovery_eligible_now
  from public.profiles p
  join public.trials t on t.user_id=p.id
  join public.subscriptions s on s.user_id=p.id
  join public.settings st on st.user_id=p.id
  where p.role<>'admin'
    and t.trial_used and t.ends_at<=stamp
    and s.started_at is null
    and st.marketing_opt_in is true;

  select count(*) filter(where s.plan='monthly'),
         count(*) filter(where s.plan='annual'),
         count(*) filter(where s.billing_status='grace'),
         count(*) filter(where s.cancel_at_period_end is true)
    into monthly_active_now,annual_active_now,grace_active_now,cancel_scheduled_now
  from public.subscriptions s
  join public.profiles p on p.id=s.user_id and p.role<>'admin'
  where s.provider='mercado_pago'
    and s.status='pro_active'
    and greatest(
      coalesce(s.current_period_end,'-infinity'::timestamptz),
      coalesce(s.grace_until,'-infinity'::timestamptz)
    )>stamp;

  select count(*) into pro_expired_now
  from public.subscriptions s
  join public.profiles p on p.id=s.user_id and p.role<>'admin'
  where s.provider='mercado_pago'
    and s.started_at is not null
    and not (
      s.status='pro_active'
      and greatest(
        coalesce(s.current_period_end,'-infinity'::timestamptz),
        coalesce(s.grace_until,'-infinity'::timestamptz)
      )>stamp
    );

  select count(distinct e.subscription_id) into cancellations_in_window
  from public.billing_events e
  join public.subscriptions s on s.id=e.subscription_id
  join public.profiles p on p.id=s.user_id and p.role<>'admin'
  where e.effect='subscription_canceled'
    and e.outcome='applied'
    and e.provider_event_at>=window_start and e.provider_event_at<=stamp;

  if card_accounts>0 then
    card_to_trial:=round((card_trials::numeric/card_accounts::numeric)*100,1);
    card_to_paid:=round((card_paid_conversions::numeric/card_accounts::numeric)*100,1);
  end if;

  return jsonb_build_object(
    'generated_at',stamp,
    'window_days',p_days,
    'window_start',window_start,
    'new_accounts',accounts_total,
    'card_accounts',card_accounts,
    'other_accounts',other_accounts,
    'trials_started',trials_started,
    'card_trials',card_trials,
    'paid_conversions',paid_conversions,
    'card_paid_conversions',card_paid_conversions,
    'paid_active_now',paid_active_now,
    'card_to_trial_percent',card_to_trial,
    'card_to_paid_percent',card_to_paid,
    'total_users_now',total_users_now,
    'free_now',free_now,
    'trial_active_now',trial_active_now,
    'trial_ending_3d_now',trial_ending_3d_now,
    'trial_expired_no_pro_now',trial_expired_no_pro_now,
    'recovery_eligible_now',recovery_eligible_now,
    'monthly_active_now',monthly_active_now,
    'annual_active_now',annual_active_now,
    'grace_active_now',grace_active_now,
    'cancel_scheduled_now',cancel_scheduled_now,
    'pro_expired_now',pro_expired_now,
    'cancellations_in_window',cancellations_in_window,
    'revenue_available',false,
    'recovered_campaign_available',false,
    'definitions',jsonb_build_object(
      'commercial_users','Contas não administrativas.',
      'trial_active_now','Trial vigente sem assinatura paga ativa.',
      'trial_ending_3d_now','Trials ativos que terminam nas próximas 72 horas.',
      'trial_expired_no_pro_now','Trial encerrado sem qualquer período pago iniciado.',
      'recovery_eligible_now','Trial encerrado sem PRO e com consentimento atual para e-mails de marketing.',
      'paid_active_now','Assinaturas Mercado Pago com acesso pago ativo ou em tolerância.',
      'cancellations_in_window','Assinaturas com evento de cancelamento aplicado dentro da janela.'
    )
  );
end $$;

revoke all on function public.get_admin_acquisition_metrics(integer)
  from public,anon,authenticated;
grant execute on function public.get_admin_acquisition_metrics(integer)
  to authenticated;

commit;
