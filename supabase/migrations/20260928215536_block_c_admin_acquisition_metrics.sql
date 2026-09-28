-- PepDay V3.0 / Bloco C — métricas agregadas de aquisição para painel administrativo.
-- Nenhum dado pessoal, rotina, frasco ou evento bruto é retornado ao frontend.
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
  card_to_trial numeric:=0;
  card_to_paid numeric:=0;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id=u and role='admin'
  ) then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  if p_days is null or p_days not in (7,30,90) then
    raise exception 'Janela administrativa inválida';
  end if;

  window_start:=stamp-(p_days*interval '1 day');

  select count(*) into accounts_total
  from public.profiles p
  where p.created_at>=window_start and p.created_at<=stamp;

  select count(*) into card_accounts
  from public.profiles p
  where p.created_at>=window_start and p.created_at<=stamp
    and exists (
      select 1 from public.acquisition_attributions a
      where a.user_id=p.id and a.source='card' and a.medium='qr'
    );

  other_accounts:=greatest(accounts_total-card_accounts,0);

  select count(*) into trials_started
  from public.trials t
  where t.started_at>=window_start and t.started_at<=stamp;

  select count(*) into card_trials
  from public.trials t
  where t.started_at>=window_start and t.started_at<=stamp
    and exists (
      select 1 from public.acquisition_attributions a
      where a.user_id=t.user_id and a.source='card' and a.medium='qr'
    );

  select count(*) into paid_conversions
  from public.subscriptions s
  where s.provider='mercado_pago'
    and s.started_at>=window_start and s.started_at<=stamp;

  select count(*) into card_paid_conversions
  from public.subscriptions s
  where s.provider='mercado_pago'
    and s.started_at>=window_start and s.started_at<=stamp
    and exists (
      select 1 from public.acquisition_attributions a
      where a.user_id=s.user_id and a.source='card' and a.medium='qr'
    );

  select count(*) into paid_active_now
  from public.subscriptions s
  where s.provider='mercado_pago'
    and s.status='pro_active'
    and greatest(
      coalesce(s.current_period_end,'-infinity'::timestamptz),
      coalesce(s.grace_until,'-infinity'::timestamptz)
    )>stamp;

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
    'definitions',jsonb_build_object(
      'card_accounts','Novas contas da janela que possuem atribuição first-touch card/qr.',
      'other_accounts','Novas contas da janela sem atribuição card/qr.',
      'paid_conversions','Assinaturas Mercado Pago cujo primeiro período pago começou na janela.',
      'paid_active_now','Assinaturas Mercado Pago com acesso pago ativo ou em tolerância neste momento.'
    )
  );
end $$;

revoke all on function public.get_admin_acquisition_metrics(integer)
  from public,anon,authenticated;
grant execute on function public.get_admin_acquisition_metrics(integer)
  to authenticated;

commit;
