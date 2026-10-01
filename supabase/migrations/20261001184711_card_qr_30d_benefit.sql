-- PepDay V3.0 — campanha do cartão físico: 30 dias PRO, uso único por conta.
-- O benefício substitui o trial de 7 dias e não cria assinatura/cobrança.
begin;

create table public.card_pro_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  acquisition_id uuid not null unique references public.acquisition_attributions(id) on delete cascade,
  campaign text not null default 'cartao-v1' check (campaign='cartao-v1'),
  duration_days integer not null default 30 check (duration_days=30),
  granted_at timestamptz not null default statement_timestamp(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  first_used_at timestamptz,
  last_used_at timestamptz,
  check (ends_at=starts_at+interval '30 days'),
  check (first_used_at is null or (first_used_at>=starts_at and first_used_at<=ends_at)),
  check (last_used_at is null or (last_used_at>=starts_at and last_used_at<=ends_at))
);

create index card_pro_grants_window_idx
  on public.card_pro_grants(starts_at,ends_at);
create index card_pro_grants_campaign_idx
  on public.card_pro_grants(campaign,granted_at desc);

alter table public.card_pro_grants enable row level security;
revoke all on public.card_pro_grants from public,anon,authenticated,service_role;
create or replace function public.get_entitlement() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  s public.subscriptions;
  t public.trials;
  p public.profiles;
  r public.promo_redemptions;
  g public.card_pro_grants;
  stamp timestamptz:=statement_timestamp();
  paid_end timestamptz;
begin
  if u is null then
    return jsonb_build_object('status','free','pro',false,'source','anonymous',
      'trial_used',false,'trial_available',false,'server_now',stamp);
  end if;

  select * into p from public.profiles where id=u;
  select * into s from public.subscriptions where user_id=u;
  select * into t from public.trials where user_id=u;
  select * into g from public.card_pro_grants where user_id=u;
  select * into r from public.promo_redemptions
    where user_id=u and starts_at<=stamp and ends_at>stamp
    order by ends_at desc limit 1;

  if p.id is null or s.id is null or t.id is null then
    raise exception 'Conta não inicializada';
  end if;
  paid_end:=greatest(coalesce(s.current_period_end,'-infinity'::timestamptz),
    coalesce(s.grace_until,'-infinity'::timestamptz));

  if p.role='admin' and s.access_override='admin' then
    return jsonb_build_object('status','pro_active','pro',true,'source','admin',
      'trial_used',t.trial_used,'trial_available',false,'server_now',stamp);
  elsif s.status='pro_active' and paid_end>stamp then
    return jsonb_build_object('status','pro_active','pro',true,'source','subscription',
      'trial_used',t.trial_used,'trial_available',false,'started_at',s.started_at,
      'ends_at',paid_end,'server_now',stamp);
  elsif g.id is not null and g.starts_at<=stamp and g.ends_at>stamp then
    return jsonb_build_object('status','pro_active','pro',true,'source','card',
      'trial_used',t.trial_used,'trial_available',false,'started_at',g.starts_at,
      'ends_at',g.ends_at,'server_now',stamp,'campaign',g.campaign);
  elsif r.id is not null then
    return jsonb_build_object('status','pro_active','pro',true,'source','promo',
      'trial_used',t.trial_used,'trial_available',false,'started_at',r.starts_at,
      'ends_at',r.ends_at,'server_now',stamp,'promo_code',r.code_snapshot);
  elsif t.trial_used and t.ends_at>stamp then
    return jsonb_build_object('status','trial','pro',true,'source','trial',
      'trial_used',true,'trial_available',false,'started_at',t.started_at,
      'ends_at',t.ends_at,'server_now',stamp);
  elsif g.id is not null then
    return jsonb_build_object('status','pro_expired','pro',false,'source','card',
      'trial_used',t.trial_used,'trial_available',false,'started_at',g.starts_at,
      'ends_at',g.ends_at,'server_now',stamp,'campaign',g.campaign);
  elsif t.trial_used then
    return jsonb_build_object('status','pro_expired','pro',false,'source','trial',
      'trial_used',true,'trial_available',false,'started_at',t.started_at,
      'ends_at',t.ends_at,'server_now',stamp);
  elsif s.status in ('pro_active','pro_expired') then
    return jsonb_build_object('status','pro_expired','pro',false,'source','subscription',
      'trial_used',false,'trial_available',false,'started_at',s.started_at,
      'ends_at',nullif(paid_end,'-infinity'::timestamptz),'server_now',stamp);
  end if;

  return jsonb_build_object('status','free','pro',false,'source','account',
    'trial_used',false,'trial_available',true,'server_now',stamp);
end $$;

revoke all on function public.get_entitlement() from public,anon,authenticated;
grant execute on function public.get_entitlement() to authenticated;

create or replace function public.start_trial() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  t public.trials;
  stamp timestamptz:=statement_timestamp();
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  select * into t from public.trials where user_id=u for update;
  if not found then raise exception 'Conta não inicializada'; end if;
  if exists(select 1 from public.card_pro_grants where user_id=u) then
    return public.get_entitlement();
  end if;
  if t.trial_used then return public.get_entitlement(); end if;

  if not exists(
    select 1 from public.profiles
    where id=u
      and is_adult_confirmed
      and terms_accepted_at is not null
      and privacy_accepted_at is not null
      and sensitive_data_consent_at is not null
  ) then raise exception 'Conclua o cadastro antes do teste'; end if;

  if (public.get_entitlement()->>'pro')::boolean then
    return public.get_entitlement();
  end if;

  update public.trials
  set trial_used=true,started_at=stamp,ends_at=stamp+interval '7 days',updated_at=stamp
  where user_id=u;

  update public.subscriptions
  set status='trial',updated_at=stamp
  where user_id=u;

  insert into public.audit_logs(user_id,action) values(u,'trial_started');
  return public.get_entitlement();
end $$;

revoke all on function public.start_trial() from public,anon,authenticated;
grant execute on function public.start_trial() to authenticated;
create or replace function public.claim_card_acquisition(
  p_first_seen_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
  seen timestamptz;
  a public.acquisition_attributions;
  p public.profiles;
  s public.subscriptions;
  g public.card_pro_grants;
  paid_end timestamptz;
  inserted_count integer:=0;
  benefit_code text;
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  select * into p from public.profiles where id=u;
  if p.id is null then raise exception 'Conta não inicializada'; end if;

  seen:=coalesce(p_first_seen_at,stamp);
  if seen>stamp+interval '5 minutes' or seen<stamp-interval '90 days' then
    seen:=stamp;
  end if;

  insert into public.acquisition_attributions(
    user_id,source,medium,campaign,landing_path,first_seen_at
  ) values (
    u,'card','qr','cartao-v1','/cartao/',seen
  ) on conflict(user_id) do nothing;
  select * into a from public.acquisition_attributions where user_id=u;

  select * into g from public.card_pro_grants where user_id=u;
  if g.id is not null then
    benefit_code:='CARD_PRO_ALREADY_GRANTED';
  elsif p.role='admin' then
    benefit_code:='CARD_PRO_ADMIN_NOT_ELIGIBLE';
  elsif not (
    p.is_adult_confirmed
    and p.terms_accepted_at is not null
    and p.privacy_accepted_at is not null
    and p.sensitive_data_consent_at is not null
  ) then
    benefit_code:='CARD_PRO_NEEDS_ONBOARDING';
  else
    select * into s from public.subscriptions where user_id=u for update;
    if s.id is null then raise exception 'Conta não inicializada'; end if;
    paid_end:=greatest(coalesce(s.current_period_end,'-infinity'::timestamptz),
      coalesce(s.grace_until,'-infinity'::timestamptz));

    if s.status='pro_active' and s.provider='mercado_pago' and paid_end>stamp then
      benefit_code:='CARD_PRO_BLOCKED_PAID';
    else
      insert into public.card_pro_grants(
        user_id,acquisition_id,campaign,duration_days,granted_at,starts_at,ends_at
      ) values (
        u,a.id,'cartao-v1',30,stamp,stamp,stamp+interval '30 days'
      ) on conflict(user_id) do nothing;
      get diagnostics inserted_count=row_count;
      select * into g from public.card_pro_grants where user_id=u;
      if inserted_count=1 then
        benefit_code:='CARD_PRO_GRANTED';
        insert into public.audit_logs(user_id,action)
        values(u,'card_pro_30d_granted');
      else
        benefit_code:='CARD_PRO_ALREADY_GRANTED';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'acquisition',jsonb_build_object(
      'source',a.source,'medium',a.medium,'campaign',a.campaign,
      'landing_path',a.landing_path,'first_seen_at',a.first_seen_at,
      'attributed_at',a.attributed_at
    ),
    'benefit',jsonb_build_object(
      'code',benefit_code,
      'duration_days',case when g.id is not null then g.duration_days else 30 end,
      'starts_at',case when g.id is not null then g.starts_at else null end,
      'ends_at',case when g.id is not null then g.ends_at else null end,
      'active',case when g.id is not null then g.starts_at<=stamp and g.ends_at>stamp else false end
    ),
    'entitlement',public.get_entitlement()
  );
end $$;

revoke all on function public.claim_card_acquisition(timestamptz)
  from public,anon,authenticated;
grant execute on function public.claim_card_acquisition(timestamptz)
  to authenticated;
create or replace function public.mark_card_pro_usage() returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
  g public.card_pro_grants;
  was_first boolean:=false;
begin
  if u is null then raise exception 'Autenticação necessária'; end if;

  select * into g from public.card_pro_grants
  where user_id=u for update;
  if g.id is null or g.starts_at>stamp or g.ends_at<=stamp then
    return jsonb_build_object('recorded',false);
  end if;

  was_first:=g.first_used_at is null;
  update public.card_pro_grants
  set first_used_at=coalesce(first_used_at,stamp),
      last_used_at=stamp
  where id=g.id
  returning * into g;

  if was_first then
    insert into public.audit_logs(user_id,action)
    values(u,'card_pro_30d_first_used');
  end if;

  return jsonb_build_object(
    'recorded',true,'first_use',was_first,
    'first_used_at',g.first_used_at,'last_used_at',g.last_used_at
  );
end $$;

revoke all on function public.mark_card_pro_usage()
  from public,anon,authenticated;
grant execute on function public.mark_card_pro_usage()
  to authenticated;
create or replace function public.get_admin_card_campaign_metrics(
  p_days integer default 30
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
  window_start timestamptz;
  attributed bigint:=0;
  granted bigint:=0;
  used bigint:=0;
  active_now bigint:=0;
  ended bigint:=0;
  paid bigint:=0;
  paid_monthly bigint:=0;
  paid_annual bigint:=0;
  qr_to_grant numeric:=0;
  grant_to_used numeric:=0;
  grant_to_paid numeric:=0;
begin
  if u is null or not exists(
    select 1 from public.profiles where id=u and role='admin'
  ) then raise exception 'Acesso administrativo necessário' using errcode='42501'; end if;

  if p_days is null or p_days not in (7,30,90) then
    raise exception 'Janela administrativa inválida';
  end if;
  window_start:=stamp-(p_days*interval '1 day');

  select count(*) into attributed
  from public.acquisition_attributions a
  join public.profiles p on p.id=a.user_id and p.role<>'admin'
  where a.campaign='cartao-v1'
    and a.attributed_at>=window_start and a.attributed_at<=stamp;
  select count(*) into granted
  from public.card_pro_grants g
  join public.profiles p on p.id=g.user_id and p.role<>'admin'
  where g.granted_at>=window_start and g.granted_at<=stamp;

  select count(*) into used
  from public.card_pro_grants g
  join public.profiles p on p.id=g.user_id and p.role<>'admin'
  where g.first_used_at>=window_start and g.first_used_at<=stamp;

  select count(*) into active_now
  from public.card_pro_grants g
  join public.profiles p on p.id=g.user_id and p.role<>'admin'
  where g.starts_at<=stamp and g.ends_at>stamp;

  select count(*) into ended
  from public.card_pro_grants g
  join public.profiles p on p.id=g.user_id and p.role<>'admin'
  where g.ends_at>=window_start and g.ends_at<=stamp;

  select count(*),
         count(*) filter(where s.plan='monthly'),
         count(*) filter(where s.plan='annual')
    into paid,paid_monthly,paid_annual
  from public.card_pro_grants g
  join public.profiles p on p.id=g.user_id and p.role<>'admin'
  join public.subscriptions s on s.user_id=g.user_id
  where s.provider='mercado_pago'
    and s.started_at is not null
    and s.started_at>=g.granted_at
    and s.started_at>=window_start and s.started_at<=stamp;
  if attributed>0 then
    qr_to_grant:=round((granted::numeric/attributed::numeric)*100,1);
  end if;
  if granted>0 then
    grant_to_used:=round((used::numeric/granted::numeric)*100,1);
    grant_to_paid:=round((paid::numeric/granted::numeric)*100,1);
  end if;

  return jsonb_build_object(
    'generated_at',stamp,'window_days',p_days,'window_start',window_start,
    'attributed_accounts',attributed,
    'grants_started',granted,
    'grants_used',used,
    'grants_active_now',active_now,
    'grants_ended',ended,
    'paid_after_grant',paid,
    'paid_monthly_after_grant',paid_monthly,
    'paid_annual_after_grant',paid_annual,
    'qr_to_grant_percent',qr_to_grant,
    'grant_to_used_percent',grant_to_used,
    'grant_to_paid_percent',grant_to_paid,
    'definitions',jsonb_build_object(
      'grants_started','Contas que receberam os 30 dias PRO do cartão na janela.',
      'grants_used','Contas cujo benefício ativo foi usado no app pela primeira vez na janela.',
      'grants_active_now','Benefícios de 30 dias vigentes agora.',
      'grants_ended','Benefícios cujo período de 30 dias terminou na janela.',
      'paid_after_grant','Assinaturas Mercado Pago iniciadas depois da concessão do cartão.'
    )
  );
end $$;

revoke all on function public.get_admin_card_campaign_metrics(integer)
  from public,anon,authenticated;
grant execute on function public.get_admin_card_campaign_metrics(integer)
  to authenticated;
create or replace function public.export_my_data()
returns jsonb
language plpgsql security definer set search_path='' as $$
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
      select to_jsonb(p)-'role'
      from public.profiles p where p.id=u
    ),
    'settings',(
      select to_jsonb(s)-'id'-'user_id'
      from public.settings s where s.user_id=u
    ),
    'subscription',(
      select jsonb_build_object(
        'status',s.status,'plan',s.plan,'provider',s.provider,
        'provider_subscription_id',s.provider_subscription_id,
        'provider_plan_id',s.provider_plan_id,
        'billing_status',s.billing_status,'provider_status',s.provider_status,
        'last_payment_status',s.last_payment_status,
        'started_at',s.started_at,'current_period_start',s.current_period_start,
        'current_period_end',s.current_period_end,'grace_until',s.grace_until,
        'cancel_at_period_end',s.cancel_at_period_end,'cancelled_at',s.cancelled_at,
        'next_plan',s.next_plan,'created_at',s.created_at,'updated_at',s.updated_at
      ) from public.subscriptions s where s.user_id=u
    ),
    'trial',(
      select jsonb_build_object(
        'trial_used',t.trial_used,'started_at',t.started_at,'ends_at',t.ends_at,
        'completed_at',t.completed_at,'created_at',t.created_at,'updated_at',t.updated_at
      ) from public.trials t where t.user_id=u
    ),
    'card_pro_benefit',(
      select jsonb_build_object(
        'campaign',g.campaign,'duration_days',g.duration_days,
        'granted_at',g.granted_at,'starts_at',g.starts_at,'ends_at',g.ends_at,
        'first_used_at',g.first_used_at,'last_used_at',g.last_used_at
      ) from public.card_pro_grants g where g.user_id=u
    ),
    'vials',coalesce((
      select jsonb_agg(to_jsonb(v)-'user_id' order by v.created_at,v.id)
      from public.vials v where v.user_id=u
    ),'[]'::jsonb),
    'routines',coalesce((
      select jsonb_agg(to_jsonb(r)-'user_id' order by r.created_at,r.id)
      from public.routines r where r.user_id=u
    ),'[]'::jsonb),
    'routine_versions',coalesce((
      select jsonb_agg(to_jsonb(rv)-'user_id' order by rv.created_at,rv.id)
      from public.routine_versions rv where rv.user_id=u
    ),'[]'::jsonb),
    'applications',coalesce((
      select jsonb_agg(to_jsonb(a)-'user_id' order by a.created_at,a.id)
      from public.applications a where a.user_id=u
    ),'[]'::jsonb),
    'vial_movements',coalesce((
      select jsonb_agg(to_jsonb(vm)-'user_id' order by vm.created_at,vm.id)
      from public.vial_movements vm where vm.user_id=u
    ),'[]'::jsonb),
    'imports',coalesce((
      select jsonb_agg(to_jsonb(i)-'user_id' order by i.created_at,i.id)
      from public.local_data_imports i where i.user_id=u
    ),'[]'::jsonb),
    'acquisition',(
      select jsonb_build_object(
        'source',a.source,'medium',a.medium,'campaign',a.campaign,
        'landing_path',a.landing_path,'first_seen_at',a.first_seen_at,
        'attributed_at',a.attributed_at
      ) from public.acquisition_attributions a where a.user_id=u
    )
  );

  insert into public.audit_logs(user_id,action) values(u,'data_exported');
  return result;
end $$;

revoke all on function public.export_my_data() from public,anon,authenticated;
grant execute on function public.export_my_data() to authenticated;

commit;
