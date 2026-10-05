-- Somente leitura agregada. Não altera entitlement, billing, campanhas ou equipe.
begin;

create or replace function public.get_admin_acquisition_metrics(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  stamp timestamptz:=statement_timestamp();
  result jsonb;
  lifecycle jsonb;
  payments bigint;
begin
  perform public.admin_assert_access(false,false);
  -- Preserva os indicadores históricos e a validação da janela.
  result:=public.get_admin_acquisition_metrics_legacy(p_days);

  with base as (
    select p.id,coalesce(st.marketing_opt_in,false) marketing,
      s.plan,s.billing_status,s.cancel_at_period_end,s.started_at paid_started,
      coalesce(s.status='pro_active' and greatest(
        coalesce(s.current_period_end,'-infinity'::timestamptz),
        coalesce(s.grace_until,'-infinity'::timestamptz))>stamp,false) paid,
      g.id is not null has_card,g.ends_at card_end,
      coalesce(g.starts_at<=stamp and g.ends_at>stamp,false) card,
      exists(select 1 from public.promo_redemptions r
        where r.user_id=p.id and r.starts_at<=stamp and r.ends_at>stamp) promo,
      coalesce(t.trial_used and t.ends_at>stamp,false) trial,
      coalesce(t.trial_used and t.ends_at<=stamp,false) trial_ended,t.ends_at trial_end
    from public.profiles p
    left join public.subscriptions s on s.user_id=p.id
    left join public.trials t on t.user_id=p.id
    left join public.settings st on st.user_id=p.id
    left join public.card_pro_grants g on g.user_id=p.id
    where p.role<>'admin'
  ), classified as (
    select *,case when paid then 'paid' when card then 'card' when promo then 'promo'
      when trial then 'trial' else 'free' end state
    from base
  ), recovery as (
    -- Cartão substitui o trial; a mesma pessoa nunca entra nos dois segmentos.
    select *,case when state='free' and has_card and card_end<=stamp then 'card'
      when state='free' and not has_card and trial_ended then 'trial' end recovery_source
    from classified
  ) select jsonb_build_object(
    'metrics_version',2,
    'total_users_now',count(*),
    'free_now',count(*) filter(where state='free'),
    'paid_active_now',count(*) filter(where state='paid'),
    'card_active_now',count(*) filter(where state='card'),
    'promo_active_now',count(*) filter(where state='promo'),
    'trial_active_now',count(*) filter(where state='trial'),
    'trial_ending_3d_now',count(*) filter(where state='trial' and trial_end<=stamp+interval '3 days'),
    'card_ending_3d_now',count(*) filter(where state='card' and card_end<=stamp+interval '3 days'),
    'trial_expired_no_pro_now',count(*) filter(where recovery_source='trial'),
    'card_expired_no_pro_now',count(*) filter(where recovery_source='card'),
    'recovery_trial_eligible_now',count(*) filter(where recovery_source='trial' and marketing),
    'recovery_card_eligible_now',count(*) filter(where recovery_source='card' and marketing),
    'recovery_eligible_now',count(*) filter(where recovery_source is not null and marketing),
    'recovery_without_consent_now',count(*) filter(where recovery_source is not null and not marketing),
    'monthly_active_now',count(*) filter(where state='paid' and plan='monthly'),
    'annual_active_now',count(*) filter(where state='paid' and plan='annual'),
    'grace_active_now',count(*) filter(where state='paid' and billing_status='grace'),
    'cancel_scheduled_now',count(*) filter(where state='paid' and cancel_at_period_end),
    'pro_expired_now',count(*) filter(where state='free' and paid_started is not null),
    'revenue_available',false,'recovered_campaign_available',false,
    'revenue_unavailable_reason','Valores pagos não são persistidos nos eventos financeiros atuais.',
    'definitions',jsonb_build_object(
      'base','Estados exclusivos: PRO pago > cartão > promo > trial > FREE. Total independente da janela.',
      'free_now','Sem qualquer acesso PRO vigente, inclusive contas com benefício ou assinatura encerrados.',
      'recovery','FREE após cartão ou trial, com consentimento atual. Cartão tem precedência; ex-PRO pode ser subconjunto.',
      'pro_expired_now','Já iniciou assinatura e está FREE agora; pode também integrar recuperação.',
      'paid_active_now','Acesso de assinatura vigente, incluindo tolerância e cancelamento agendado.'
    )
  ) into lifecycle from recovery;

  select count(distinct (e.subscription_id,e.provider_resource_id)) into payments
  from public.billing_events e
  join public.subscriptions s on s.id=e.subscription_id
  join public.profiles p on p.id=s.user_id and p.role<>'admin'
  where e.effect='payment_approved' and e.outcome='applied'
    and e.event_type='subscription_authorized_payment'
    and e.provider_event_at between stamp-p_days*interval '1 day' and stamp;
  return result||lifecycle||jsonb_build_object('approved_charges_in_window',payments);
end $$;

-- Taxas seguem coortes: mesmas contas/benefícios no numerador e denominador.
-- Contagens de eventos por período continuam disponíveis nos cards históricos.
create or replace function public.get_admin_card_campaign_metrics(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  stamp timestamptz:=statement_timestamp();
  result jsonb;
  attributed bigint;
  activated bigint;
  granted bigint;
  used bigint;
  paid bigint;
begin
  perform public.admin_assert_access(false,false);
  result:=public.get_admin_card_campaign_metrics_legacy(p_days);
  select count(*),count(*) filter(where g.granted_at<=stamp)
    into attributed,activated
  from public.acquisition_attributions a
  join public.profiles p on p.id=a.user_id and p.role<>'admin'
  left join public.card_pro_grants g on g.user_id=a.user_id
  where a.source='card' and a.medium='qr' and a.campaign='cartao-v1'
    and a.attributed_at between stamp-p_days*interval '1 day' and stamp;

  select count(*),count(*) filter(where g.first_used_at<=stamp),
    count(*) filter(where s.provider='mercado_pago' and s.started_at>=g.granted_at and s.started_at<=stamp)
    into granted,used,paid
  from public.card_pro_grants g
  join public.profiles p on p.id=g.user_id and p.role<>'admin'
  left join public.subscriptions s on s.user_id=g.user_id
  where g.granted_at between stamp-p_days*interval '1 day' and stamp;
  return result||jsonb_build_object(
    'metrics_version',2,'cohort_attributed',attributed,'cohort_activated',activated,
    'cohort_granted',granted,'cohort_used',used,'cohort_paid',paid,
    'qr_to_grant_percent',case when attributed>0 then round(100.0*activated/attributed,1) else null end,
    'grant_to_used_percent',case when granted>0 then round(100.0*used/granted,1) else null end,
    'grant_to_paid_percent',case when granted>0 then round(100.0*paid/granted,1) else null end
  );
end $$;

revoke all on function public.get_admin_acquisition_metrics(integer) from public,anon,authenticated;
revoke all on function public.get_admin_card_campaign_metrics(integer) from public,anon,authenticated;
grant execute on function public.get_admin_acquisition_metrics(integer) to authenticated;
grant execute on function public.get_admin_card_campaign_metrics(integer) to authenticated;
commit;
