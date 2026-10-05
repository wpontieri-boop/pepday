-- Recuperação v1 — implantação de produção aprovada em 05/10/2026.
-- Nasce desativada. Ativação ocorre somente após Edges/templates/smokes de PROD.
begin;

create table public.recovery_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  provider_ready boolean not null default false,
  template_ids jsonb not null default '{}'
);
insert into public.recovery_config(singleton) values(true);

create table public.recovery_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  version text not null default 'recovery-v1' check(version='recovery-v1'),
  source text not null check(source in ('trial','card')),
  benefit_start timestamptz not null,
  benefit_end timestamptz not null,
  status text not null default 'active' check(status in ('active','stopped','converted','completed')),
  stop_reason text,
  created_at timestamptz not null default statement_timestamp(),
  offer_starts_at timestamptz not null,
  offer_expires_at timestamptz not null,
  checkout_request_id uuid unique,
  checkout_started_at timestamptz,
  provider_subscription_id text unique,
  provider_checked_at timestamptz,
  checkout_url text,
  redeemed_at timestamptz,
  first_invoice_id text unique,
  first_amount numeric(12,2),
  price_reset_at timestamptz,
  converted_at timestamptz,
  check(benefit_end>benefit_start),
  check(offer_expires_at=offer_starts_at+interval '72 hours')
);

create table public.recovery_email_outbox (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.recovery_campaigns(id) on delete cascade,
  stage text not null check(stage in ('warning','ended','resume','offer','last')),
  available_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','processing','retry','sent','dead','suppressed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  worker_id uuid,
  locked_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error_code text,
  unique(campaign_id,stage),
  check(expires_at>available_at)
);

create index recovery_email_ready_idx on public.recovery_email_outbox(available_at)
  where status in ('pending','retry','processing');
create index recovery_campaign_provider_pending_idx on public.recovery_campaigns(offer_expires_at)
  where provider_subscription_id is not null and price_reset_at is null;

create table public.recovery_worker_invocations (
  token_hash bytea primary key,
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.recovery_config enable row level security;
alter table public.recovery_campaigns enable row level security;
alter table public.recovery_email_outbox enable row level security;
alter table public.recovery_worker_invocations enable row level security;
revoke all on public.recovery_config,public.recovery_campaigns,public.recovery_email_outbox,public.recovery_worker_invocations
  from public,anon,authenticated,service_role;

create function public.recovery_candidate(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare g public.card_pro_grants;t public.trials;s public.subscriptions;
begin
  if not exists(
    select 1 from public.profiles p join public.settings st on st.user_id=p.id
    where p.id=p_user_id and p.role<>'admin'
      and st.marketing_opt_in is true
      and st.marketing_accepted_at is not null
      and st.marketing_accepted_at<=statement_timestamp()
  ) then return null;end if;

  select * into s from public.subscriptions where user_id=p_user_id;
  if s.status='pro_active'
    and greatest(coalesce(s.current_period_end,'-infinity'),coalesce(s.grace_until,'-infinity'))>statement_timestamp()
  then return null;end if;

  if exists(select 1 from public.promo_redemptions where user_id=p_user_id and ends_at>statement_timestamp())
  then return null;end if;

  select * into g from public.card_pro_grants where user_id=p_user_id;
  if g.id is not null then
    return jsonb_build_object('source','card','start',g.starts_at,'end',g.ends_at);
  end if;

  select * into t from public.trials where user_id=p_user_id and trial_used;
  if t.id is not null then
    return jsonb_build_object('source','trial','start',t.started_at,'end',t.ends_at);
  end if;
  return null;
end $$;

create function public.prepare_recovery_campaigns() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a record;c public.recovery_campaigns;candidate jsonb;stamp timestamptz:=statement_timestamp();n integer:=0;
begin
  if not (select enabled from public.recovery_config where singleton is true)
  then return jsonb_build_object('outcome','disabled');end if;

  perform pg_advisory_xact_lock(hashtext('pepday-recovery-v1'));

  update public.recovery_email_outbox
    set status='dead',error_code='DELIVERY_UNKNOWN',worker_id=null
    where status='processing' and locked_at<stamp-interval '15 minutes';

  for a in
    select p.id as user_id
    from public.profiles p
    where p.role<>'admin' and public.recovery_candidate(p.id) is not null
  loop
    candidate:=public.recovery_candidate(a.user_id);
    if candidate is null then continue;end if;

    insert into public.recovery_campaigns(user_id,source,benefit_start,benefit_end,offer_starts_at,offer_expires_at)
    values(
      a.user_id,candidate->>'source',
      (candidate->>'start')::timestamptz,(candidate->>'end')::timestamptz,
      (candidate->>'end')::timestamptz+interval '5 days',
      (candidate->>'end')::timestamptz+interval '8 days'
    )
    on conflict(user_id) do nothing;

    select * into c from public.recovery_campaigns where user_id=a.user_id;
    if c.status<>'active' then continue;end if;

    if c.source<>candidate->>'source' or c.benefit_end<>(candidate->>'end')::timestamptz then
      update public.recovery_campaigns
        set status='stopped',stop_reason='BENEFIT_CHANGED'
        where id=c.id;
      continue;
    end if;

    insert into public.recovery_email_outbox(campaign_id,stage,available_at,expires_at)
    values
      (c.id,'warning',
        c.benefit_end-case when c.source='card' then interval '3 days' else interval '2 days' end,
        c.benefit_end),
      (c.id,'ended',c.benefit_end,c.benefit_end+interval '1 day'),
      (c.id,'resume',c.benefit_end+interval '2 days',c.benefit_end+interval '4 days'),
      (c.id,'offer',c.offer_starts_at,c.offer_expires_at-interval '1 day'),
      (c.id,'last',c.offer_starts_at+interval '2 days',c.offer_expires_at)
    on conflict(campaign_id,stage) do nothing;
    n:=n+1;
  end loop;

  update public.recovery_email_outbox o
    set status='suppressed',worker_id=null,error_code='CAMPAIGN_STOPPED_OR_STAGE_EXPIRED'
    from public.recovery_campaigns rc
    where rc.id=o.campaign_id
      and o.status in ('pending','retry','processing')
      and (rc.status<>'active' or o.expires_at<=stamp);

  update public.recovery_campaigns
    set status='completed',stop_reason='OFFER_EXPIRED'
    where status='active' and offer_expires_at<=stamp and provider_subscription_id is null;

  return jsonb_build_object('outcome','prepared','accounts',n);
end $$;

create function public.claim_recovery_email(p_worker_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.recovery_email_outbox;c public.recovery_campaigns;p public.profiles;candidate jsonb;cfg public.recovery_config;
begin
  if p_worker_id is null then raise exception 'Worker inválido';end if;
  select * into cfg from public.recovery_config where singleton is true;
  if not cfg.enabled then return jsonb_build_object('outcome','empty');end if;

  select * into o
  from public.recovery_email_outbox
  where available_at<=statement_timestamp()
    and expires_at>statement_timestamp()
    and attempts<5 and status in ('pending','retry')
  order by available_at,id
  for update skip locked limit 1;

  if o.id is null then return jsonb_build_object('outcome','empty');end if;
  select * into c from public.recovery_campaigns where id=o.campaign_id;
  candidate:=public.recovery_candidate(c.user_id);

  if c.status<>'active' or candidate is null or candidate->>'source'<>c.source then
    update public.recovery_email_outbox set status='suppressed',error_code='ELIGIBILITY_REVOKED' where id=o.id;
    return jsonb_build_object('outcome','suppressed');
  end if;

  if o.stage in ('offer','last') and not cfg.provider_ready
  then return jsonb_build_object('outcome','provider_not_ready');end if;
  if coalesce((cfg.template_ids->>o.stage)::integer,0)<=0
  then return jsonb_build_object('outcome','template_missing');end if;

  select * into p from public.profiles where id=c.user_id;
  update public.recovery_email_outbox
    set status='processing',attempts=attempts+1,worker_id=p_worker_id,locked_at=statement_timestamp()
    where id=o.id returning * into o;

  return jsonb_build_object(
    'outcome','claimed','id',o.id,'campaign_id',c.id,'stage',o.stage,'source',c.source,
    'attempt',o.attempts,'recipient',jsonb_build_object('email',p.email,'name',p.name),
    'template_id',cfg.template_ids->o.stage,'benefit_end',c.benefit_end,'offer_expires_at',c.offer_expires_at
  );
end $$;

create function public.validate_recovery_email(p_id uuid,p_worker_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.recovery_email_outbox o
    join public.recovery_campaigns c on c.id=o.campaign_id
    where o.id=p_id and o.worker_id=p_worker_id
      and o.status='processing' and o.expires_at>statement_timestamp()
      and c.status='active'
      and (select enabled from public.recovery_config where singleton is true)
      and public.recovery_candidate(c.user_id)->>'source'=c.source
  );
$$;

create function public.complete_recovery_email(p_id uuid,p_worker_id uuid,p_outcome text,p_message_id text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_outcome not in ('sent','retry','dead','suppressed') then raise exception 'Resultado inválido';end if;
  update public.recovery_email_outbox
    set status=case when p_outcome='retry' and attempts>=5 then 'dead' else p_outcome end,
        available_at=case when p_outcome='retry' then statement_timestamp()+interval '5 minutes' else available_at end,
        sent_at=case when p_outcome='sent' then statement_timestamp() else sent_at end,
        provider_message_id=left(p_message_id,300),worker_id=null,locked_at=null
    where id=p_id and worker_id=p_worker_id and status='processing';
end $$;

create function public.reserve_recovery_offer(p_user_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.recovery_campaigns;stamp timestamptz:=statement_timestamp();candidate jsonb;
begin
  if p_user_id is null or p_request_id is null then raise exception 'Requisição inválida';end if;
  perform 1 from public.subscriptions where user_id=p_user_id for update;
  select * into c from public.recovery_campaigns where user_id=p_user_id for update;
  candidate:=public.recovery_candidate(p_user_id);

  if not exists(select 1 from public.recovery_config where singleton is true and enabled and provider_ready)
    or c.id is null or c.status<>'active' or candidate is null or candidate->>'source'<>c.source
    or stamp<c.offer_starts_at or stamp>=c.offer_expires_at or c.redeemed_at is not null
  then return jsonb_build_object('outcome','ineligible');end if;

  if c.checkout_request_id is null then
    update public.recovery_campaigns
      set checkout_request_id=p_request_id
      where id=c.id returning * into c;
  end if;

  return jsonb_build_object(
    'outcome','reserved','campaign_id',c.id,'request_id',c.checkout_request_id,
    'provider_subscription_id',c.provider_subscription_id,'checkout_url',c.checkout_url,
    'expires_at',c.offer_expires_at
  );
end $$;

create function public.claim_recovery_checkout(p_campaign_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.recovery_campaigns
    set checkout_started_at=statement_timestamp()
    where id=p_campaign_id
      and checkout_started_at is null
      and checkout_request_id is not null
      and provider_subscription_id is null
      and status='active'
      and offer_expires_at>statement_timestamp()
      and public.recovery_candidate(user_id) is not null;
  return found;
end $$;

create function public.bind_recovery_checkout(p_campaign_id uuid,p_provider_id text,p_url text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if length(p_provider_id) not between 1 and 200
    or p_url !~ '^https://([a-z0-9-]+[.])*mercadopago[.]com([.]br)?/'
  then raise exception 'Checkout inválido';end if;

  update public.recovery_campaigns
    set provider_subscription_id=p_provider_id,checkout_url=p_url
    where id=p_campaign_id and checkout_request_id is not null
      and status='active' and statement_timestamp()<offer_expires_at
      and public.recovery_candidate(user_id) is not null
      and (provider_subscription_id is null or provider_subscription_id=p_provider_id);

  if not found then raise exception 'Checkout não associado';end if;
end $$;

create function public.recover_recovery_checkout(p_campaign_id uuid,p_provider_id text,p_url text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if length(p_provider_id) not between 1 and 200
    or p_url !~ '^https://([a-z0-9-]+[.])*mercadopago[.]com([.]br)?/'
  then raise exception 'Checkout inválido';end if;

  update public.recovery_campaigns
    set provider_subscription_id=p_provider_id,checkout_url=p_url
    where id=p_campaign_id and checkout_started_at is not null and provider_subscription_id is null;
end $$;

create function public.mark_recovery_provider_checked(p_campaign_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.recovery_campaigns set provider_checked_at=statement_timestamp() where id=p_campaign_id;
end $$;

create function public.get_my_recovery_offer() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.recovery_campaigns;
begin
  select * into c from public.recovery_campaigns where user_id=auth.uid();
  if c.id is null or c.status<>'active' or c.redeemed_at is not null
    or statement_timestamp()<c.offer_starts_at
    or statement_timestamp()>=c.offer_expires_at
    or public.recovery_candidate(c.user_id) is null
    or not exists(select 1 from public.recovery_config where singleton is true and enabled and provider_ready)
  then return null;end if;

  return jsonb_build_object(
    'campaign_id',c.id,'expires_at',c.offer_expires_at,
    'first_price',9.90,'recurring_price',14.90
  );
end $$;

create function public.stop_recovery_sequence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='subscriptions'
    and to_jsonb(new)->>'status'='pro_active'
    and to_jsonb(new)->>'provider'='mercado_pago'
    and to_jsonb(new)->>'last_payment_status'='approved'
  then
    update public.recovery_campaigns c
      set status='converted',converted_at=statement_timestamp(),stop_reason='PAID_AFTER_CAMPAIGN'
      where c.user_id=new.user_id and c.converted_at is null
        and (c.status='active' or (c.status='stopped' and c.stop_reason='SUBSCRIPTION_AUTHORIZED'))
        and exists(
          select 1 from public.recovery_email_outbox o
          where o.campaign_id=c.id and o.status='sent'
            and o.sent_at between statement_timestamp()-interval '7 days' and statement_timestamp()
        );
  end if;

  if (tg_table_name='settings' and (to_jsonb(new)->>'marketing_opt_in')::boolean is not true)
    or (tg_table_name='subscriptions' and to_jsonb(new)->>'status'='pro_active')
  then
    update public.recovery_campaigns
      set status='stopped',
          stop_reason=case when tg_table_name='settings' then 'CONSENT_REVOKED' else 'SUBSCRIBED' end
      where user_id=new.user_id and status='active';

    update public.recovery_email_outbox o
      set status='suppressed',worker_id=null,error_code='SEQUENCE_STOPPED'
      from public.recovery_campaigns c
      where c.id=o.campaign_id and c.user_id=new.user_id
        and o.status in ('pending','retry','processing');
  end if;
  return new;
end $$;

create trigger recovery_stop_on_consent
  after update of marketing_opt_in on public.settings
  for each row execute function public.stop_recovery_sequence();

create trigger recovery_stop_on_paid
  after update of status on public.subscriptions
  for each row execute function public.stop_recovery_sequence();

create function public.recovery_provider_state() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'config',(select to_jsonb(cfg) from public.recovery_config cfg where singleton is true),
    'pending',coalesce((
      select jsonb_agg(
        to_jsonb(c)||jsonb_build_object('subscription_id',s.id)
        order by c.provider_checked_at nulls first
      )
      from public.recovery_campaigns c
      join public.subscriptions s on s.user_id=c.user_id
      where (c.provider_subscription_id is not null and c.price_reset_at is null)
        or (c.provider_subscription_id is null and c.checkout_started_at is not null)
        or (c.status='converted' and c.provider_subscription_id is not null
          and (c.provider_checked_at is null or c.provider_checked_at<statement_timestamp()-interval '1 day'))
    ),'[]'::jsonb)
  );
$$;

create function public.record_recovery_payment(
  p_provider_id text,p_invoice_id text,p_amount numeric,p_paid_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.recovery_campaigns;
begin
  select * into c from public.recovery_campaigns
    where provider_subscription_id=p_provider_id for update;
  if c.id is null then return jsonb_build_object('outcome','normal');end if;
  if c.redeemed_at is not null then
    return jsonb_build_object('outcome','duplicate','reset_needed',c.price_reset_at is null);
  end if;
  if p_paid_at is null or p_paid_at<c.offer_starts_at or p_paid_at>=c.offer_expires_at
    or p_amount is distinct from 9.90 or coalesce(trim(p_invoice_id),'')=''
  then return jsonb_build_object('outcome','invalid');end if;

  update public.recovery_campaigns
    set redeemed_at=p_paid_at,first_invoice_id=p_invoice_id,first_amount=p_amount,
        status='converted',converted_at=statement_timestamp()
    where id=c.id;

  update public.recovery_email_outbox
    set status='suppressed',worker_id=null
    where campaign_id=c.id and status in ('pending','retry','processing');

  return jsonb_build_object('outcome','converted','reset_needed',true);
end $$;

create function public.update_recovery_provider_state(p_provider_id text,p_outcome text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_outcome='reset' then
    update public.recovery_campaigns
      set price_reset_at=statement_timestamp()
      where provider_subscription_id=p_provider_id and redeemed_at is not null;
  elsif p_outcome='authorized' then
    update public.recovery_campaigns
      set status='stopped',stop_reason='SUBSCRIPTION_AUTHORIZED'
      where provider_subscription_id=p_provider_id and status='active';
    update public.recovery_email_outbox o
      set status='suppressed',worker_id=null
      from public.recovery_campaigns c
      where c.id=o.campaign_id and c.provider_subscription_id=p_provider_id
        and o.status in ('pending','retry','processing');
  elsif p_outcome='canceled' then
    update public.recovery_campaigns
      set status='completed',stop_reason='PROVIDER_CANCELED',price_reset_at=statement_timestamp()
      where provider_subscription_id=p_provider_id and redeemed_at is null;
  else raise exception 'Resultado inválido';
  end if;
end $$;

create function public.configure_recovery(p_templates jsonb,p_provider_ready boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.recovery_config
    set template_ids=p_templates,provider_ready=p_provider_ready
    where singleton is true;
end $$;

create function public.consume_recovery_invocation(p_token text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.recovery_worker_invocations
    set used_at=statement_timestamp()
    where token_hash=extensions.digest(lower(p_token),'sha256')
      and used_at is null and expires_at>statement_timestamp();
  return found;
end $$;

create function public.block_recovery_courtesy_stack() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.subscriptions where user_id=new.user_id for update;
  if exists(
    select 1 from public.recovery_campaigns
    where user_id=new.user_id
      and (
        (checkout_request_id is not null and price_reset_at is null and offer_expires_at>statement_timestamp())
        or (redeemed_at is not null and redeemed_at+interval '1 month'>statement_timestamp())
      )
  ) then raise exception 'Oferta de recuperação em andamento; não acumulável com cortesia';end if;
  return new;
end $$;

create trigger recovery_no_courtesy_stack
  before insert on public.promo_redemptions
  for each row execute function public.block_recovery_courtesy_stack();

create function public.get_admin_recovery_metrics(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform public.admin_assert_access(false,false);
  if p_days not in (7,30,90) then raise exception 'Janela inválida';end if;
  return (
    select jsonb_build_object(
      'recovery_automation_test',false,
      'recovery_environment','production',
      'recovery_enabled',(select enabled from public.recovery_config where singleton is true),
      'recovery_provider_ready',(select provider_ready from public.recovery_config where singleton is true),
      'recovered_campaign_available',true,
      'recovered_campaign_count',count(*) filter(where converted_at>=statement_timestamp()-p_days*interval '1 day'),
      'recovered_trial_count',count(*) filter(where source='trial' and converted_at>=statement_timestamp()-p_days*interval '1 day'),
      'recovered_card_count',count(*) filter(where source='card' and converted_at>=statement_timestamp()-p_days*interval '1 day'),
      'recovery_revenue_first_cycle',coalesce(sum(first_amount) filter(where converted_at>=statement_timestamp()-p_days*interval '1 day'),0),
      'recovery_price_reset_pending',count(*) filter(where redeemed_at is not null and price_reset_at is null)
    )
    from public.recovery_campaigns
  );
end $$;

create function public.revoke_recovery_marketing_consent() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Autenticação necessária';end if;
  update public.settings
    set marketing_opt_in=false,marketing_accepted_at=null,version=version+1,updated_at=statement_timestamp()
    where user_id=auth.uid();
end $$;

create function public.dispatch_recovery_worker(p_action text default 'run') returns jsonb
language plpgsql security definer set search_path='' as $$
declare base_url text;token uuid:=gen_random_uuid();request_id bigint;
begin
  if p_action not in ('run','setup') then raise exception 'Ação inválida';end if;
  select decrypted_secret into base_url
    from vault.decrypted_secrets
    where name='pepday_supabase_project_url'
    order by created_at desc limit 1;

  if rtrim(coalesce(base_url,''),'/')<>'https://oslefjmwfnddxlotalxu.supabase.co'
  then return jsonb_build_object('outcome','production_url_mismatch');end if;

  if p_action='run' and not (select enabled from public.recovery_config where singleton is true)
  then return jsonb_build_object('outcome','disabled');end if;

  delete from public.recovery_worker_invocations
    where expires_at<statement_timestamp()-interval '1 day';

  insert into public.recovery_worker_invocations
  values(extensions.digest(token::text,'sha256'),statement_timestamp()+interval '2 minutes',null);

  select net.http_post(
    url:=rtrim(base_url,'/')||'/functions/v1/recovery-worker',
    headers:=jsonb_build_object('Content-Type','application/json','x-pepday-invocation-token',token::text),
    body:=jsonb_build_object('action',p_action),
    timeout_milliseconds:=60000
  ) into request_id;

  return jsonb_build_object('outcome','requested','request_id',request_id);
end $$;

select cron.schedule(
  'pepday-recovery-prod-worker',
  '*/5 * * * *',
  'select public.dispatch_recovery_worker();'
);

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname like '%recovery%' or p.proname='stop_recovery_sequence')
  loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
  end loop;
end $$;

grant execute on function public.prepare_recovery_campaigns() to service_role;
grant execute on function public.claim_recovery_email(uuid) to service_role;
grant execute on function public.validate_recovery_email(uuid,uuid) to service_role;
grant execute on function public.complete_recovery_email(uuid,uuid,text,text) to service_role;
grant execute on function public.reserve_recovery_offer(uuid,uuid) to service_role;
grant execute on function public.claim_recovery_checkout(uuid) to service_role;
grant execute on function public.bind_recovery_checkout(uuid,text,text) to service_role;
grant execute on function public.recover_recovery_checkout(uuid,text,text) to service_role;
grant execute on function public.mark_recovery_provider_checked(uuid) to service_role;
grant execute on function public.recovery_provider_state() to service_role;
grant execute on function public.record_recovery_payment(text,text,numeric,timestamptz) to service_role;
grant execute on function public.update_recovery_provider_state(text,text) to service_role;
grant execute on function public.configure_recovery(jsonb,boolean) to service_role;
grant execute on function public.consume_recovery_invocation(text) to service_role;

grant execute on function public.get_my_recovery_offer() to authenticated;
grant execute on function public.get_admin_recovery_metrics(integer) to authenticated;
grant execute on function public.revoke_recovery_marketing_consent() to authenticated;

commit;
