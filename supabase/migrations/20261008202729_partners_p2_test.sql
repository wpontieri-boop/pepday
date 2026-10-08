-- P2 TEST only. Preserve commercial grant core; no billing/P3 mutation.
begin;
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'PARTNERS_TEST_ONLY';end if;
end $$;
alter table public.partner_config add column referral_enabled boolean not null default false;
create table public.partner_referral_intents(
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 partner_id uuid not null references public.partners(id) on delete restrict,
 source text not null check(source in ('link','code','manual')),
 created_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default (statement_timestamp()+interval '30 days'),
 superseded_at timestamptz,superseded_reason text check(superseded_reason in ('replaced','cleared')),consumed_at timestamptz,
 check(expires_at=created_at+interval '30 days'),
 check(not(superseded_at is not null and consumed_at is not null))
);
create index partner_intents_partner_idx on public.partner_referral_intents(partner_id,created_at);
create index partner_intents_expiry_idx on public.partner_referral_intents(expires_at) where consumed_at is null and superseded_at is null;
create table public.partner_attributions(
 id uuid primary key default gen_random_uuid(),
 user_id uuid unique references public.profiles(id) on delete set null,
 card_grant_id uuid unique references public.card_pro_grants(id) on delete set null,
 partner_id uuid references public.partners(id) on delete restrict,
 rule_id uuid references public.partner_commission_rules(id) on delete restrict,
 rule_version integer,commission_percent numeric(5,2),
 intent_id uuid unique references public.partner_referral_intents(id) on delete restrict,
 source text not null check(source in ('link','code','manual','none','historical_none')),
 locked_at timestamptz not null default statement_timestamp(),
 check((partner_id is null and rule_id is null and rule_version is null and commission_percent is null and intent_id is null and source in ('none','historical_none')) or
       (partner_id is not null and rule_id is not null and rule_version is not null and commission_percent is not null and commission_percent between 0 and 100 and intent_id is not null and source in ('link','code','manual')))
);
create index partner_attributions_partner_idx on public.partner_attributions(partner_id,locked_at);
create index partner_attributions_rule_idx on public.partner_attributions(rule_id);
create function public.partner_attribution_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'user_id'-'card_grant_id')<>(to_jsonb(old)-'user_id'-'card_grant_id')
    or (new.user_id is distinct from old.user_id and new.user_id is not null)
    or (new.card_grant_id is distinct from old.card_grant_id and new.card_grant_id is not null) then
  raise exception 'PARTNER_ATTRIBUTION_LOCKED';
 end if;
 return new;
end $$;
revoke all on function public.partner_attribution_immutable() from public,anon,authenticated,service_role;
create trigger partner_attribution_lock before update on public.partner_attributions for each row execute function public.partner_attribution_immutable();
create table public.partner_click_events(
 event_id uuid primary key,
 partner_id uuid not null references public.partners(id) on delete restrict,
 source text not null check(source in ('link','code')),
 created_at timestamptz not null default statement_timestamp()
);
create index partner_clicks_partner_idx on public.partner_click_events(partner_id,created_at);
create index partner_clicks_time_idx on public.partner_click_events(created_at);
create table public.partner_click_daily(
 partner_id uuid not null references public.partners(id) on delete restrict,
 day date not null,clicks bigint not null default 0,primary key(partner_id,day)
);
do $$declare t text;begin
 foreach t in array array['partner_referral_intents','partner_attributions','partner_click_events','partner_click_daily'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
-- Existing grants are sealed WITHOUT retroactive partner assignment or new grants.
insert into public.partner_attributions(user_id,card_grant_id,source,locked_at)
select user_id,id,'historical_none',granted_at from public.card_pro_grants;

create function public.partner_referral_action(p_action text,p_ref text default '',p_source text default 'link',p_previous_token text default '',p_confirm_swap boolean default false,p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.partner_referral_intents; candidate public.partners; token text; found_data jsonb; quota jsonb; stamp timestamptz:=statement_timestamp(); added integer;
begin
 if not exists(select 1 from public.partner_config where enabled and referral_enabled) then return jsonb_build_object('enabled',false);end if;
 if p_action not in ('intent','inspect','clear') or p_action is null or length(coalesce(p_ref,''))>100 or p_source is null or p_source not in ('link','code','manual') then raise exception 'REFERRAL_INVALID_REQUEST';end if;
 quota:=public.partner_public_search('','');
 if coalesce((quota->>'limited')::boolean,false) then return jsonb_build_object('enabled',true,'limited',true);end if;
 if coalesce(p_previous_token,'') ~ '^[a-f0-9]{64}$' then
  select * into previous from public.partner_referral_intents where token_hash=encode(sha256(convert_to(p_previous_token,'UTF8')),'hex') for update;
 end if;
 if previous.id is not null and (previous.consumed_at is not null or previous.superseded_at is not null) then return jsonb_build_object('enabled',true,'code','INTENT_UNAVAILABLE');end if;
 if p_action='clear' then
  update public.partner_referral_intents set superseded_at=stamp,superseded_reason='cleared' where id=previous.id and consumed_at is null;
  return jsonb_build_object('enabled',true,'code','CLEARED');
 end if;
 if p_action='inspect' then
  if previous.id is null or previous.expires_at<=stamp then return jsonb_build_object('enabled',true,'code','INTENT_EXPIRED_OR_MISSING');end if;
  select * into candidate from public.partners where id=previous.partner_id and status='active' for share;
 else
  select * into candidate from public.partners where status='active' and
   ((p_source='code' and public_code=upper(p_ref)) or (p_source in ('link','manual') and slug=lower(p_ref))) for share;
 end if;
 if candidate.id is null then return jsonb_build_object('enabled',true,'code','PARTNER_UNAVAILABLE');end if;
 found_data:=jsonb_build_object('public_name',candidate.public_name,'city',candidate.city,'description',candidate.description,'partner_type',candidate.partner_type,'slug',candidate.slug,'public_code',candidate.public_code);
 if p_action='inspect' then return jsonb_build_object('enabled',true,'code','VALID','partner',found_data,'source',previous.source,'expires_at',previous.expires_at);end if;
 if previous.id is not null and previous.expires_at>stamp and previous.source in ('link','code') and p_source='manual' and previous.partner_id<>candidate.id and not coalesce(p_confirm_swap,false) then
  return jsonb_build_object('enabled',true,'code','CONFIRM_SWAP_REQUIRED','partner',found_data);
 end if;
 -- Clicks are directional and deduplicated separately from intents/conversions.
 if p_source in ('link','code') and p_event_id is not null then
  insert into public.partner_click_events(event_id,partner_id,source) values(p_event_id,candidate.id,p_source) on conflict do nothing;
  get diagnostics added=row_count;
  if added=1 then insert into public.partner_click_daily values(candidate.id,(stamp at time zone 'UTC')::date,1) on conflict(partner_id,day) do update set clicks=partner_click_daily.clicks+1;end if;
 end if;
 delete from public.partner_click_events where created_at<stamp-interval '30 days';
 if previous.id is not null and previous.expires_at>stamp and previous.partner_id=candidate.id and previous.source=p_source then
  return jsonb_build_object('enabled',true,'code','VALID','token',p_previous_token,'partner',found_data,'source',previous.source,'expires_at',previous.expires_at);
 end if;
 update public.partner_referral_intents set superseded_at=stamp,superseded_reason='replaced' where id=previous.id and consumed_at is null;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.partner_referral_intents(token_hash,partner_id,source,created_at,expires_at)
 values(encode(sha256(convert_to(token,'UTF8')),'hex'),candidate.id,p_source,stamp,stamp+interval '30 days');
 return jsonb_build_object('enabled',true,'code','CREATED','token',token,'partner',found_data,'source',p_source,'expires_at',stamp+interval '30 days');
end $$;
revoke all on function public.partner_referral_action(text,text,text,text,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.partner_referral_action(text,text,text,text,boolean,uuid) to service_role;

-- Preserve the existing commercial core verbatim, but close direct invocation.
alter function public.claim_card_acquisition(timestamptz) rename to claim_card_acquisition_core_p2;
revoke all on function public.claim_card_acquisition_core_p2(timestamptz) from public,anon,authenticated,service_role;
create function public.partner_claim_card(p_first_seen_at timestamptz,p_intent_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); intent public.partner_referral_intents; partner public.partners; rule public.partner_commission_rules; grant_row public.card_pro_grants; result jsonb; old_grant uuid; stamp timestamptz:=statement_timestamp();
begin
 if u is null then raise exception 'Autenticação necessária';end if;
 -- Same lock order for every caller, including legacy. Account isolation via auth.uid.
 perform 1 from public.profiles where id=u for update;
 if not found then raise exception 'Conta não inicializada';end if;
 select id into old_grant from public.card_pro_grants where user_id=u;
 if old_grant is null and exists(select 1 from public.partner_config where enabled and referral_enabled)
    and coalesce(p_intent_token,'') ~ '^[a-f0-9]{64}$' then
  select * into intent from public.partner_referral_intents where token_hash=encode(sha256(convert_to(p_intent_token,'UTF8')),'hex') for update;
  if intent.id is not null and intent.consumed_at is null and intent.superseded_at is null and intent.expires_at>clock_timestamp() then
   select * into partner from public.partners where id=intent.partner_id and status='active' for share;
   if partner.id is not null then select * into rule from public.partner_commission_rules where partner_id=partner.id order by version desc limit 1;end if;
  end if;
 end if;
 result:=public.claim_card_acquisition_core_p2(p_first_seen_at);
 select * into grant_row from public.card_pro_grants where user_id=u;
 if grant_row.id is not null and not exists(select 1 from public.partner_attributions where user_id=u) then
  -- Recheck expiry after waiting for legacy locks. No partner = valid benefit with sealed absence.
  if old_grant is null and partner.id is not null and rule.id is not null and intent.expires_at>clock_timestamp() then
   insert into public.partner_attributions(user_id,card_grant_id,partner_id,rule_id,rule_version,commission_percent,intent_id,source,locked_at)
   values(u,grant_row.id,partner.id,rule.id,rule.version,rule.commission_percent,intent.id,intent.source,stamp);
   update public.partner_referral_intents set consumed_at=stamp where id=intent.id;
  else
   insert into public.partner_attributions(user_id,card_grant_id,source,locked_at) values(u,grant_row.id,case when old_grant is null then 'none' else 'historical_none' end,stamp);
  end if;
 end if;
 return result;
end $$;
revoke all on function public.partner_claim_card(timestamptz,text) from public,anon,authenticated,service_role;
create function public.claim_card_acquisition(p_first_seen_at timestamptz default null) returns jsonb
language sql security definer set search_path='' as $$select public.partner_claim_card(p_first_seen_at,null)$$;
create function public.claim_partner_card_acquisition(p_intent_token text default null,p_first_seen_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; attribution public.partner_attributions; partner public.partners;
begin
 result:=public.partner_claim_card(p_first_seen_at,p_intent_token);
 select * into attribution from public.partner_attributions where user_id=auth.uid();
 select * into partner from public.partners where id=attribution.partner_id;
 return result||jsonb_build_object('partner_locked',attribution.id is not null,'partner',case when partner.id is null then null else jsonb_build_object('public_name',partner.public_name,'city',partner.city,'description',partner.description) end);
end $$;
revoke all on function public.claim_card_acquisition(timestamptz),public.claim_partner_card_acquisition(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.claim_card_acquisition(timestamptz),public.claim_partner_card_acquisition(text,timestamptz) to authenticated;

create function public.admin_partner_referral_metrics() returns jsonb
language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=statement_timestamp();begin
 perform public.partner_admin_assert(false,false);
 delete from public.partner_click_events where created_at<stamp-interval '30 days';
 return jsonb_build_object('enabled',(select referral_enabled from public.partner_config),'clicks',(select coalesce(sum(clicks),0) from public.partner_click_daily),
 'intents_created',(select count(*) from public.partner_referral_intents),
 'intents_replaced',(select count(*) from public.partner_referral_intents where superseded_reason='replaced'),
 'intents_expired',(select count(*) from public.partner_referral_intents where expires_at<=stamp and consumed_at is null and superseded_at is null),
 'intents_consumed',(select count(*) from public.partner_referral_intents where consumed_at is not null),
 'benefits_with_partner',(select count(*) from public.partner_attributions where partner_id is not null),
 'benefits_without_partner',(select count(*) from public.partner_attributions where source='none'),
 'partners',coalesce((select jsonb_agg(jsonb_build_object('public_name',p.public_name,'slug',p.slug,'activations',coalesce(a.activations,0),'clicks',coalesce(c.clicks,0))) from public.partners p
 left join (select partner_id,count(*) activations from public.partner_attributions where partner_id is not null group by partner_id) a on a.partner_id=p.id
 left join (select partner_id,sum(clicks) clicks from public.partner_click_daily group by partner_id) c on c.partner_id=p.id
 where a.activations>0 or c.clicks>0),'[]'::jsonb));
end $$;
revoke all on function public.admin_partner_referral_metrics() from public,anon,authenticated,service_role;
grant execute on function public.admin_partner_referral_metrics() to authenticated;
commit;
