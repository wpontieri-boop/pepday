-- PepDay V3.0 / Bloco B1. Aplicar uma vez, somente em pepday-v3-test.
-- Evolui apenas as RPCs de entitlement/trial; não altera migrations aplicadas.
begin;

create or replace function public.get_entitlement() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); s public.subscriptions; t public.trials; p public.profiles;
  stamp timestamptz:=statement_timestamp(); paid_end timestamptz;
begin
  if u is null then
    return jsonb_build_object('status','free','pro',false,'source','anonymous',
      'trial_used',false,'trial_available',false,'server_now',stamp);
  end if;
  select * into p from public.profiles where id=u;
  select * into s from public.subscriptions where user_id=u;
  select * into t from public.trials where user_id=u;
  if p.id is null or s.id is null or t.id is null then raise exception 'Conta não inicializada'; end if;

  paid_end:=greatest(coalesce(s.current_period_end,'-infinity'::timestamptz),
    coalesce(s.grace_until,'-infinity'::timestamptz));
  if p.role='admin' and s.access_override='admin' then
    return jsonb_build_object('status','pro_active','pro',true,'source','admin',
      'trial_used',t.trial_used,'trial_available',false,'server_now',stamp);
  elsif s.status='pro_active' and paid_end>stamp then
    return jsonb_build_object('status','pro_active','pro',true,'source','subscription',
      'trial_used',t.trial_used,'trial_available',false,'started_at',s.started_at,
      'ends_at',paid_end,'server_now',stamp);
  elsif t.trial_used and t.ends_at>stamp then
    return jsonb_build_object('status','trial','pro',true,'source','trial',
      'trial_used',true,'trial_available',false,'started_at',t.started_at,
      'ends_at',t.ends_at,'server_now',stamp);
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
  u uuid:=auth.uid(); t public.trials; s public.subscriptions;
  current_access jsonb; stamp timestamptz:=statement_timestamp();
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  -- Uma linha única por conta e lock serializam cliques/reenvios concorrentes.
  select * into t from public.trials where user_id=u for update;
  select * into s from public.subscriptions where user_id=u for update;
  if t.id is null or s.id is null then raise exception 'Conta não inicializada'; end if;
  if t.trial_used then return public.get_entitlement(); end if;
  if not exists(select 1 from public.profiles where id=u and is_adult_confirmed
    and terms_accepted_at is not null and privacy_accepted_at is not null) then
    raise exception 'Conclua o cadastro antes do teste';
  end if;
  current_access:=public.get_entitlement();
  if current_access->>'status'<>'free' then return current_access; end if;

  update public.trials set trial_used=true,started_at=stamp,
    ends_at=stamp+interval '7 days',completed_at=null,updated_at=stamp where user_id=u;
  update public.subscriptions set status='trial',updated_at=stamp where user_id=u;
  insert into public.audit_logs(user_id,action) values(u,'trial_started');
  return public.get_entitlement();
end $$;
revoke all on function public.start_trial() from public,anon,authenticated;
grant execute on function public.start_trial() to authenticated;

commit;
