-- P3 is additive and TEST-only. No entitlement/billing function is rewritten.
begin;
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'PARTNERS_TEST_ONLY';end if;
end $$;
alter table public.partner_config add column finance_enabled boolean not null default false;
alter table public.partner_config add column finance_cursor integer not null default 0;
create table public.partner_financial_payments(
 id uuid primary key default gen_random_uuid(), provider_payment_id text not null unique check(length(provider_payment_id) between 1 and 100),
 provider_invoice_id text not null,
 subscription_id uuid references public.subscriptions(id) on delete set null,
 user_id uuid references public.profiles(id) on delete set null,
 attribution_id uuid references public.partner_attributions(id) on delete restrict,
 plan text check(plan in ('monthly','annual','recovery')),currency text,
 gross_cents bigint check(gross_cents>=0),refunded_cents bigint not null default 0 check(refunded_cents>=0),
 paid_at timestamptz,provider_updated_at timestamptz not null,
 state text not null check(state in ('approved','refunded','charged_back','disputed','review')),
 history_complete boolean not null default false,first_payment_id text,
 reconciled_at timestamptz not null default statement_timestamp(),
 check(gross_cents is null or refunded_cents<=gross_cents)
);
create index partner_payments_subscription_idx on public.partner_financial_payments(subscription_id,paid_at);
create index partner_payments_user_idx on public.partner_financial_payments(user_id,paid_at);
create index partner_payments_attribution_idx on public.partner_financial_payments(attribution_id);
create table public.partner_commissions(
 id uuid primary key default gen_random_uuid(),attribution_id uuid not null unique references public.partner_attributions(id) on delete restrict,
 partner_id uuid not null references public.partners(id) on delete restrict,
 payment_id uuid not null unique references public.partner_financial_payments(id) on delete restrict,
 percent numeric(5,2) not null check(percent between 0 and 100),
 earned_cents bigint not null default 0 check(earned_cents>=0),paid_cents bigint not null default 0 check(paid_cents>=0),
 reserved_cents bigint not null default 0 check(reserved_cents>=0),
 state text not null check(state in ('pending','released','reserved','paid','review','voided','reversed')),
 reason text,release_at timestamptz,manual_voided_at timestamptz,review_required boolean not null default false,review_approved_at timestamptz,debt_reference_private text,debt_proof_sha256 text,debt_settled_cents bigint not null default 0 check(debt_settled_cents>=0),version bigint not null default 1
);
create index partner_commissions_partner_idx on public.partner_commissions(partner_id,state);
create table public.partner_ledger_entries(
 id uuid primary key default gen_random_uuid(),commission_id uuid not null references public.partner_commissions(id) on delete restrict,
 kind text not null check(kind in ('generated','released','reserved','unreserved','paid','adjusted','review','resolved','debt_settled')),
 amount_cents bigint not null,idempotency_key text not null unique,
 actor_id uuid references public.profiles(id) on delete set null,reason text not null,evidence_private jsonb,created_at timestamptz not null default statement_timestamp()
);
create index partner_ledger_commission_idx on public.partner_ledger_entries(commission_id,created_at);
create index partner_ledger_actor_idx on public.partner_ledger_entries(actor_id);
create table public.partner_payouts(
 id uuid primary key default gen_random_uuid(),partner_id uuid not null references public.partners(id) on delete restrict,
 request_id uuid not null unique,state text not null check(state in ('reserved','canceled','paid')),
 total_cents bigint not null check(total_cents>0),recipient_snapshot jsonb not null,
 created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default statement_timestamp(),
 paid_at timestamptz,reference_private text,proof_sha256 text,reason text not null
);
create index partner_payouts_partner_idx on public.partner_payouts(partner_id,state);
create index partner_payouts_actor_idx on public.partner_payouts(created_by);
create table public.partner_payout_items(
 payout_id uuid not null references public.partner_payouts(id) on delete restrict,
 commission_id uuid not null references public.partner_commissions(id) on delete restrict,
 amount_cents bigint not null check(amount_cents>0),primary key(payout_id,commission_id)
);
create index partner_payout_items_commission_idx on public.partner_payout_items(commission_id);
create table public.partner_finance_tickets(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.profiles(id) on delete cascade,
 session_id uuid not null,partner_id uuid not null references public.partners(id) on delete restrict,
 payload_hash text not null,expires_at timestamptz not null,used_at timestamptz
);
create index partner_finance_tickets_actor_idx on public.partner_finance_tickets(actor_id);
create index partner_finance_tickets_partner_idx on public.partner_finance_tickets(partner_id);
create table public.partner_finance_invocations(token_hash bytea primary key,expires_at timestamptz not null,used_at timestamptz);
do $$declare t text;begin
 foreach t in array array['partner_financial_payments','partner_commissions','partner_ledger_entries','partner_payouts','partner_payout_items','partner_finance_tickets','partner_finance_invocations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create function public.partner_ledger_immutable() returns trigger language plpgsql set search_path='' as $$begin
 -- Only FK anonymization may clear an actor when a user is deleted.
 if tg_op='UPDATE' and old.actor_id is not null and new.actor_id is null and (to_jsonb(new)-'actor_id')=(to_jsonb(old)-'actor_id') then return new;end if;
 raise exception 'PARTNER_LEDGER_APPEND_ONLY';end $$;
create trigger partner_ledger_lock before update or delete on public.partner_ledger_entries for each row execute function public.partner_ledger_immutable();
create function public.partner_finance_assert() returns void language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'PARTNERS_TEST_ONLY';end if;
 if not exists(select 1 from public.partner_config where enabled and finance_enabled) then raise exception 'PARTNER_FINANCE_DISABLED';end if;
end $$;
create function public.partner_finance_entry(p_commission uuid,p_kind text,p_amount bigint,p_key text,p_reason text,p_evidence jsonb default null) returns void
language sql security definer set search_path='' as $$
 insert into public.partner_ledger_entries(commission_id,kind,amount_cents,idempotency_key,actor_id,reason,evidence_private)
 values(p_commission,p_kind,p_amount,p_key,auth.uid(),p_reason,p_evidence) on conflict(idempotency_key) do nothing;
$$;
-- All P3 mutations take the partner row first, then the finance advisory lock.
-- P1 also takes the partner row, so status/profile edits cannot race a payout.
create function public.partner_finance_lock(p_partner uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.partners where id=p_partner for update;
 if not found then raise exception 'PARTNER_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_partner::text,31003));
end $$;
create function public.partner_refresh_commission(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.partner_commissions;p public.partner_financial_payments;a public.partner_attributions;earned bigint;why text;next_state text;delta bigint;
begin
 select * into strict c from public.partner_commissions where id=p_id for update;
 select * into strict p from public.partner_financial_payments where id=c.payment_id;
 select * into strict a from public.partner_attributions where id=c.attribution_id;
 earned:=case when p.currency='BRL' and p.gross_cents is not null then round((p.gross_cents-p.refunded_cents)::numeric*c.percent/100)::bigint else 0 end;
 if p.state='charged_back' then earned:=0;end if;
 why:=case
  when c.manual_voided_at is not null then 'VOIDED_BY_OWNER'
  when not p.history_complete or p.first_payment_id is null then 'HISTORY_UNPROVEN'
  when p.provider_payment_id<>p.first_payment_id then 'NOT_FIRST_PAYMENT'
  when p.paid_at is null or p.paid_at<a.locked_at then 'PAYMENT_BEFORE_ATTRIBUTION'
  when exists(select 1 from public.billing_events b join public.subscriptions s on s.id=b.subscription_id where s.user_id=a.user_id and b.effect='payment_approved' and b.provider_resource_id<>p.provider_invoice_id and b.provider_event_at<p.paid_at) then 'EARLIER_BILLING_PAYMENT'
  when p.gross_cents is null or p.currency is distinct from 'BRL' or p.plan is null then 'CANONICAL_VALUE_MISSING'
  when p.state in ('disputed','review') then 'PROVIDER_REVIEW'
  when (select status from public.partners where id=c.partner_id)<>'active' then 'PARTNER_INACTIVE'
  when a.user_id is null or not exists(select 1 from public.partner_private_profiles f join auth.users u on u.id=a.user_id where f.partner_id=c.partner_id and length(trim(f.email))>0 and u.email is not null) then 'IDENTITY_UNPROVEN'
  when exists(select 1 from public.partner_private_profiles f join auth.users u on u.id=a.user_id where f.partner_id=c.partner_id and lower(f.email)=lower(u.email)) then 'SELF_REFERRAL'
  else null end;
 if why in ('VOIDED_BY_OWNER','SELF_REFERRAL','NOT_FIRST_PAYMENT','PAYMENT_BEFORE_ATTRIBUTION','EARLIER_BILLING_PAYMENT') then earned:=0;end if;
 if why is not null and why<>'VOIDED_BY_OWNER' then update public.partner_commissions set review_required=true,review_approved_at=null where id=c.id;
 elsif c.review_required and c.review_approved_at is null then why:='OWNER_REVIEW_REQUIRED';end if;
 -- Unknown history/value/dispute is never released through an OWNER override.
 if (earned<c.earned_cents or why is not null) and c.reserved_cents>0 then
  -- Cancellation is atomic for the whole reserved batch, not just the affected item.
  perform public.partner_cancel_reserved_payouts(c.partner_id,'CANONICAL_ADJUSTMENT');
  select * into strict c from public.partner_commissions where id=p_id for update;
 end if;
 delta:=earned-c.earned_cents;
 if delta<>0 then perform public.partner_finance_entry(c.id,'adjusted',delta,'adjust:'||p.id||':'||p.provider_updated_at||':'||earned,'CANONICAL_CUMULATIVE_ADJUSTMENT');end if;
 next_state:=case when c.paid_cents>earned then 'reversed' when why='VOIDED_BY_OWNER' then 'voided' when why is not null then 'review' when earned=0 then 'voided' when c.reserved_cents>0 then 'reserved' when c.paid_cents>=earned then 'paid' when c.state='released' then 'released' else 'pending' end;
 if next_state='review' and (c.state<>'review' or c.reason is distinct from why) then perform public.partner_finance_entry(c.id,'review',0,'review:'||c.id||':'||c.version||':'||why,why);end if;
 update public.partner_commissions set earned_cents=earned,state=next_state,reason=why,version=version+case when state<>next_state or earned_cents<>earned or reason is distinct from why then 1 else 0 end where id=c.id;
end $$;
create function public.partner_cancel_reserved_payouts(p_partner uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare batch public.partner_payouts;item record;
begin
 for batch in select * from public.partner_payouts where partner_id=p_partner and state='reserved' order by id for update loop
  for item in select * from public.partner_payout_items where payout_id=batch.id order by commission_id loop
   update public.partner_commissions set reserved_cents=0,state='pending',version=version+1 where id=item.commission_id;
   perform public.partner_finance_entry(item.commission_id,'unreserved',-item.amount_cents,'unreserve:'||batch.id||':'||item.commission_id,p_reason);
  end loop;
  update public.partner_payouts set state='canceled',reason=p_reason where id=batch.id;
 end loop;
end $$;
create function public.partner_ingest_payment(p_subscription uuid,p_payment jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subscriptions;a public.partner_attributions;p public.partner_financial_payments;cid uuid;pid uuid;amount bigint;stamp timestamptz;paid timestamptz;history boolean;earliest text;c record;
begin
 perform public.partner_finance_assert();
 select * into strict s from public.subscriptions where id=p_subscription;
 select * into a from public.partner_attributions where user_id=s.user_id and partner_id is not null;
 if a.id is null then return jsonb_build_object('outcome','unattributed');end if;
 perform public.partner_finance_lock(a.partner_id);
 if jsonb_typeof(p_payment) is distinct from 'object' or length(coalesce(p_payment->>'id','')) not between 1 and 100 or length(coalesce(p_payment->>'invoice_id','')) not between 1 and 100 or coalesce(p_payment->>'state','') not in ('approved','refunded','charged_back','disputed','review') or p_payment->>'live_mode' is distinct from 'false' then raise exception 'PARTNER_INVALID_CANONICAL_PAYMENT';end if;
 amount:=(p_payment->>'gross_cents')::bigint;stamp:=(p_payment->>'updated_at')::timestamptz;paid:=(p_payment->>'paid_at')::timestamptz;
 if stamp is null or stamp>statement_timestamp()+interval '5 minutes' or paid>statement_timestamp()+interval '5 minutes' then raise exception 'PARTNER_INVALID_CANONICAL_TIME';end if;
 history:=coalesce((p_payment->>'history_complete')::boolean,false);earliest:=p_payment->>'first_payment_id';
 select * into p from public.partner_financial_payments where provider_payment_id=p_payment->>'id' for update;
 if p.id is not null and p.subscription_id is distinct from s.id then raise exception 'PARTNER_PAYMENT_MAPPING_CONFLICT';end if;
 if p.id is not null and stamp<p.provider_updated_at then return jsonb_build_object('outcome','stale');end if;
 if p.id is not null and ((p.gross_cents is not null and amount is distinct from p.gross_cents) or (p.paid_at is not null and paid is distinct from p.paid_at) or (p.currency is not null and p_payment->>'currency' is distinct from p.currency)) then raise exception 'PARTNER_IMMUTABLE_CANONICAL_BASE';end if;
 if p.id is not null and coalesce((p_payment->>'refunded_cents')::bigint,0)<p.refunded_cents then raise exception 'PARTNER_REFUND_REGRESSION';end if;
 if p.id is not null and p.provider_invoice_id is distinct from p_payment->>'invoice_id' then raise exception 'PARTNER_PAYMENT_MAPPING_CONFLICT';end if;
 insert into public.partner_financial_payments(provider_payment_id,provider_invoice_id,subscription_id,user_id,attribution_id,plan,currency,gross_cents,refunded_cents,paid_at,provider_updated_at,state,history_complete,first_payment_id)
 values(p_payment->>'id',p_payment->>'invoice_id',s.id,s.user_id,a.id,p_payment->>'plan',p_payment->>'currency',amount,coalesce((p_payment->>'refunded_cents')::bigint,0),paid,stamp,p_payment->>'state',history,earliest)
 on conflict(provider_payment_id) do update set gross_cents=coalesce(partner_financial_payments.gross_cents,excluded.gross_cents),paid_at=coalesce(partner_financial_payments.paid_at,excluded.paid_at),currency=coalesce(partner_financial_payments.currency,excluded.currency),plan=coalesce(partner_financial_payments.plan,excluded.plan),refunded_cents=excluded.refunded_cents,provider_updated_at=excluded.provider_updated_at,state=excluded.state,history_complete=excluded.history_complete,first_payment_id=excluded.first_payment_id,reconciled_at=statement_timestamp() returning id into pid;
 -- One commission per sealed attribution. Later discovery of an earlier payment
 -- sends the existing item to review/zero; never silently replaces a paid origin.
 if earliest=p_payment->>'id' or not history then
  insert into public.partner_commissions(attribution_id,partner_id,payment_id,percent,state,release_at)
  values(a.id,a.partner_id,pid,a.commission_percent,'pending',paid+interval '30 days') on conflict(attribution_id) do nothing returning id into cid;
  if cid is not null then
   update public.partner_commissions set earned_cents=case when amount is not null and p_payment->>'currency'='BRL' then round(amount::numeric*a.commission_percent/100)::bigint else 0 end where id=cid;
   perform public.partner_finance_entry(cid,'generated',(select earned_cents from public.partner_commissions where id=cid),'generate:'||cid,'CANONICAL_FIRST_PAYMENT');
  end if;
 end if;
 -- Reconcile proof across the account; discovering older history blocks any prior item.
 if history then update public.partner_financial_payments set history_complete=true,first_payment_id=earliest where attribution_id=a.id;end if;
 update public.partner_commissions set release_at=paid+interval '30 days' where payment_id=pid and release_at is null;
 for c in select id from public.partner_commissions where attribution_id=a.id loop perform public.partner_refresh_commission(c.id);end loop;
 return jsonb_build_object('outcome','reconciled','payment_id',pid);
end $$;
create function public.partner_release_commissions(p_partner uuid) returns integer language plpgsql security definer set search_path='' as $$
declare c record;n integer:=0;
begin
 perform public.partner_finance_assert();perform public.partner_finance_lock(p_partner);
 for c in select id from public.partner_commissions where partner_id=p_partner order by id loop
  perform public.partner_refresh_commission(c.id);
  update public.partner_commissions set state='released',version=version+1 where id=c.id and state='pending' and release_at<=statement_timestamp() and earned_cents>paid_cents
   and exists(select 1 from public.partner_financial_payments p where p.id=payment_id and p.history_complete and p.reconciled_at>statement_timestamp()-interval '15 minutes' and p.state in ('approved','refunded'));
  if found then n:=n+1;perform public.partner_finance_entry(c.id,'released',0,'release:'||c.id||':'||(select version from public.partner_commissions where id=c.id),'RECONCILED_AFTER_30_DAYS');end if;
 end loop;return n;
end $$;
-- Private recipient snapshots and references never appear in aggregate/admin lists.
create function public.admin_prepare_partner_finance(p_partner uuid,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare proof jsonb;pwd boolean:=false;totp boolean:=false;ticket uuid;
begin
 perform public.partner_finance_assert();perform public.partner_admin_assert(true,true);
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(p_payload->>'action','') not in ('reserve','cancel','confirm','resolve','approve','settle_debt','recipient') or octet_length(p_payload::text)>4096 or not exists(select 1 from public.partners where id=p_partner) then raise exception 'PARTNER_INVALID_FINANCE_ACTION';end if;
 for proof in select value from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) loop
  if (proof->>'timestamp')~'^[0-9]+$' and (proof->>'timestamp')::numeric between extract(epoch from statement_timestamp())-300 and extract(epoch from statement_timestamp())+5 then pwd:=pwd or proof->>'method'='password';totp:=totp or proof->>'method'='totp';end if;
 end loop;
 if not pwd or not totp then raise exception 'PARTNER_RECENT_PASSWORD_TOTP_REQUIRED' using errcode='42501';end if;
 insert into public.partner_finance_tickets(actor_id,session_id,partner_id,payload_hash,expires_at)
 values(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_partner,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),statement_timestamp()+interval '5 minutes') returning id into ticket;
 return ticket;
end $$;
create function public.admin_partner_finance_action(p_partner uuid,p_payload jsonb,p_ticket uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare operation text:=p_payload->>'action';batch public.partner_payouts;item record;c public.partner_commissions;profile public.partner_private_profiles;pid uuid;total bigint;changed integer;action_reason text:=trim(coalesce(p_payload->>'reason',''));stamp timestamptz;reference text;
begin
 perform public.partner_finance_assert();perform public.partner_admin_assert(true,true);perform public.partner_finance_lock(p_partner);
 if coalesce(operation,'') not in ('reserve','cancel','confirm','resolve','approve','settle_debt','recipient') or jsonb_typeof(p_payload) is distinct from 'object' or length(action_reason) not between 3 and 200 or action_reason~*'(@|https?://|[0-9]{11})' then raise exception 'PARTNER_INVALID_FINANCE_ACTION';end if;
 update public.partner_finance_tickets set used_at=statement_timestamp() where id=p_ticket and actor_id=auth.uid() and session_id=(auth.jwt()->>'session_id')::uuid and partner_id=p_partner and used_at is null and expires_at>statement_timestamp() and payload_hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 get diagnostics changed=row_count;if changed<>1 then raise exception 'PARTNER_STEPUP_INVALID' using errcode='42501';end if;
 if operation='recipient' then
  select * into strict batch from public.partner_payouts where id=(p_payload->>'payout_id')::uuid and partner_id=p_partner and state='reserved';
  if (select status from public.partners where id=p_partner)<>'active' or (select version from public.partner_private_profiles where partner_id=p_partner)<>(batch.recipient_snapshot->>'version')::integer then raise exception 'PARTNER_PROFILE_CHANGED_CANCEL_BATCH';end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_payout_recipient_view',jsonb_build_object('partner_id',p_partner,'payout_id',batch.id));
  return jsonb_build_object('payee_name',batch.recipient_snapshot->>'payee_name','pix_type',batch.recipient_snapshot->>'pix_type','pix_key',batch.recipient_snapshot->>'pix_key');
 end if;
 if operation='reserve' then
  select * into batch from public.partner_payouts where request_id=(p_payload->>'request_id')::uuid;
  if batch.id is not null then if batch.partner_id<>p_partner then raise exception 'PARTNER_PAYOUT_CONFLICT';end if;return jsonb_build_object('id',batch.id,'state',batch.state,'total_cents',batch.total_cents);end if;
  perform public.partner_release_commissions(p_partner);
  if (select status from public.partners where id=p_partner)<>'active' or exists(select 1 from public.partner_commissions where partner_id=p_partner and paid_cents>earned_cents+debt_settled_cents) then raise exception 'PARTNER_PAYOUT_BLOCKED';end if;
  select * into strict profile from public.partner_private_profiles where partner_id=p_partner;
  if profile.verified_at is null or profile.pix_key is null or profile.document is null or profile.payee_name is null then raise exception 'PARTNER_PAYMENT_PROFILE_REQUIRED';end if;
  select sum(earned_cents-paid_cents) into total from public.partner_commissions where partner_id=p_partner and state='released' and reserved_cents=0;
  if coalesce(total,0)<=0 then raise exception 'PARTNER_NO_RELEASED_BALANCE';end if;
  insert into public.partner_payouts(partner_id,request_id,state,total_cents,recipient_snapshot,created_by,reason)
   values(p_partner,(p_payload->>'request_id')::uuid,'reserved',total,jsonb_build_object('version',profile.version,'document',profile.document,'pix_type',profile.pix_type,'pix_key',profile.pix_key,'payee_name',profile.payee_name),auth.uid(),action_reason) returning id into pid;
  for c in select * from public.partner_commissions where partner_id=p_partner and state='released' and reserved_cents=0 order by id for update loop
   insert into public.partner_payout_items values(pid,c.id,c.earned_cents-c.paid_cents);
   update public.partner_commissions set reserved_cents=earned_cents-paid_cents,state='reserved',version=version+1 where id=c.id;
   perform public.partner_finance_entry(c.id,'reserved',c.earned_cents-c.paid_cents,'reserve:'||pid||':'||c.id,action_reason);
  end loop;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_payout_reserved',jsonb_build_object('partner_id',p_partner,'payout_id',pid,'total_cents',total));
  return jsonb_build_object('id',pid,'state','reserved','total_cents',total);
 elsif operation in ('cancel','confirm') then
  select * into strict batch from public.partner_payouts where id=(p_payload->>'payout_id')::uuid and partner_id=p_partner for update;
  if batch.state='paid' and operation='confirm' then return jsonb_build_object('id',batch.id,'state','paid');end if;
  if batch.state='canceled' and operation='cancel' then return jsonb_build_object('id',batch.id,'state','canceled');end if;
  if batch.state<>'reserved' then raise exception 'PARTNER_PAYOUT_NOT_RESERVED';end if;
  if operation='cancel' then
   for item in select * from public.partner_payout_items where payout_id=batch.id order by commission_id loop
    update public.partner_commissions set reserved_cents=0,state='pending',version=version+1 where id=item.commission_id;
    perform public.partner_finance_entry(item.commission_id,'unreserved',-item.amount_cents,'unreserve:'||batch.id||':'||item.commission_id,action_reason);
   end loop;update public.partner_payouts set state='canceled',reason=action_reason where id=batch.id;
  else
   if (select status from public.partners where id=p_partner)<>'active' or exists(select 1 from public.partner_commissions where partner_id=p_partner and paid_cents>earned_cents+debt_settled_cents) then raise exception 'PARTNER_PAYOUT_BLOCKED';end if;
   if profile.version is null then select * into profile from public.partner_private_profiles where partner_id=p_partner;end if;
   if profile.version<>(batch.recipient_snapshot->>'version')::integer then raise exception 'PARTNER_PROFILE_CHANGED_CANCEL_BATCH';end if;
   reference:=trim(coalesce(p_payload->>'reference',''));stamp:=(p_payload->>'paid_at')::timestamptz;
   if length(reference) not between 3 and 120 or reference~*'(https?://|@)' or coalesce(p_payload->>'proof_sha256','')!~'^[a-f0-9]{64}$' or p_payload->>'amount_cents' is null or (p_payload->>'amount_cents')::bigint<>batch.total_cents or stamp is null or stamp<batch.created_at or stamp>statement_timestamp()+interval '5 minutes' then raise exception 'PARTNER_PRIVATE_PROOF_REQUIRED';end if;
   for item in select i.* from public.partner_payout_items i where i.payout_id=batch.id order by i.commission_id loop
    select * into strict c from public.partner_commissions where id=item.commission_id for update;
    if c.state<>'reserved' or c.reserved_cents<>item.amount_cents or c.earned_cents-c.paid_cents<item.amount_cents or not exists(select 1 from public.partner_financial_payments p where p.id=c.payment_id and p.reconciled_at>statement_timestamp()-interval '15 minutes' and p.state in ('approved','refunded')) then raise exception 'PARTNER_RECONCILIATION_REQUIRED';end if;
    update public.partner_commissions set paid_cents=paid_cents+item.amount_cents,reserved_cents=0,state='paid',version=version+1 where id=c.id;
    perform public.partner_finance_entry(c.id,'paid',item.amount_cents,'paid:'||batch.id||':'||c.id,'MANUAL_PAYOUT_CONFIRMED');
   end loop;
   update public.partner_payouts set state='paid',paid_at=stamp,reference_private=reference,proof_sha256=p_payload->>'proof_sha256',reason=action_reason where id=batch.id;
  end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_payout_'||operation,jsonb_build_object('partner_id',p_partner,'payout_id',batch.id));
  return jsonb_build_object('id',batch.id,'state',case when operation='confirm' then 'paid' else 'canceled' end);
 else
  select * into strict c from public.partner_commissions where id=(p_payload->>'commission_id')::uuid and partner_id=p_partner for update;
  if operation='resolve' then
   -- OWNER may document an annulment, never approve an unproven payment.
   if c.state not in ('review','pending','released') then raise exception 'PARTNER_CANONICAL_REVIEW_UNRESOLVED';end if;
   update public.partner_commissions set manual_voided_at=statement_timestamp(),version=version+1 where id=c.id;
   perform public.partner_finance_entry(c.id,'resolved',0,'resolve:'||c.id||':'||c.version,action_reason);perform public.partner_refresh_commission(c.id);
  elsif operation='approve' then
   perform public.partner_refresh_commission(c.id);select cm.* into strict c from public.partner_commissions cm where cm.id=c.id;
   if c.reason is distinct from 'OWNER_REVIEW_REQUIRED' then raise exception 'PARTNER_CANONICAL_REVIEW_UNRESOLVED';end if;
   update public.partner_commissions set review_approved_at=statement_timestamp(),version=version+1 where id=c.id;
   perform public.partner_finance_entry(c.id,'resolved',0,'approve:'||c.id||':'||c.version,action_reason);perform public.partner_refresh_commission(c.id);
  else
   if c.paid_cents<=c.earned_cents+c.debt_settled_cents or length(trim(coalesce(p_payload->>'reference',''))) not between 3 and 120 or coalesce(p_payload->>'proof_sha256','')!~'^[a-f0-9]{64}$' then raise exception 'PARTNER_DEBT_EVIDENCE_REQUIRED';end if;
   perform public.partner_finance_entry(c.id,'debt_settled',c.paid_cents-c.earned_cents-c.debt_settled_cents,'settle:'||c.id||':'||c.version,action_reason,jsonb_build_object('reference',p_payload->>'reference','proof_sha256',p_payload->>'proof_sha256'));
   update public.partner_commissions set debt_reference_private=p_payload->>'reference',debt_proof_sha256=p_payload->>'proof_sha256',debt_settled_cents=paid_cents-earned_cents,version=version+1 where id=c.id;
  end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_finance_'||operation,jsonb_build_object('partner_id',p_partner,'commission_id',c.id,'reason',action_reason));
  return jsonb_build_object('id',c.id,'outcome',operation);
 end if;
end $$;
create function public.admin_partner_finance(p_partner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare level text;result jsonb;
begin
 perform public.partner_finance_assert();level:=public.partner_admin_assert(false,false);
 return jsonb_build_object('enabled',true,'can_manage',level='owner',
 'revenue',coalesce((select jsonb_agg(to_jsonb(r)) from (select a.partner_id,count(*) filter(where f.gross_cents is not null and f.currency='BRL') payments,count(*) filter(where f.gross_cents is null or f.currency is distinct from 'BRL') unproven,sum(f.gross_cents) filter(where f.currency='BRL') gross_cents,sum(f.refunded_cents) filter(where f.currency='BRL') refunded_cents,sum(case when f.state='charged_back' then 0 else f.gross_cents-f.refunded_cents end) filter(where f.currency='BRL') retained_cents from public.partner_financial_payments f join public.partner_attributions a on a.id=f.attribution_id where p_partner is null or a.partner_id=p_partner group by a.partner_id) r),'[]'),
 'partners',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'public_name',p.public_name,'pending_cents',coalesce((select sum(c.earned_cents-c.paid_cents) from public.partner_commissions c where c.partner_id=p.id and c.state='pending'),0),'released_cents',coalesce((select sum(c.earned_cents-c.paid_cents) from public.partner_commissions c where c.partner_id=p.id and c.state='released' and p.status='active'),0),'paid_cents',coalesce((select sum(c.paid_cents) from public.partner_commissions c where c.partner_id=p.id),0),'debt_cents',coalesce((select sum(greatest(c.paid_cents-c.earned_cents-c.debt_settled_cents,0)) from public.partner_commissions c where c.partner_id=p.id),0))) from public.partners p where p_partner is null or p.id=p_partner),'[]'),
 'commissions',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'partner_id',c.partner_id,'plan',f.plan,'earned_cents',c.earned_cents,'paid_cents',c.paid_cents,'reserved_cents',c.reserved_cents,'state',case when p.status<>'active' and c.state not in ('paid','reversed','voided') then 'review' else c.state end,'reason',case when p.status<>'active' then 'PARTNER_INACTIVE' else c.reason end,'release_at',c.release_at,'percent',c.percent)) from public.partner_commissions c join public.partners p on p.id=c.partner_id join public.partner_financial_payments f on f.id=c.payment_id where p_partner is null or c.partner_id=p_partner),'[]'),
 'payouts',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'partner_id',b.partner_id,'state',b.state,'total_cents',b.total_cents,'created_at',b.created_at,'paid_at',b.paid_at)) from public.partner_payouts b where p_partner is null or b.partner_id=p_partner),'[]'),
 'ledger',coalesce((select jsonb_agg(jsonb_build_object('commission_id',l.commission_id,'kind',l.kind,'amount_cents',l.amount_cents,'created_at',l.created_at,'reason',l.reason)) from (select * from public.partner_ledger_entries order by created_at desc limit 100) l join public.partner_commissions c on c.id=l.commission_id where p_partner is null or c.partner_id=p_partner),'[]'));
end $$;
create function public.admin_partner_finance_ledger(p_partner uuid default null,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform public.partner_finance_assert();perform public.partner_admin_assert(false,false);
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'PARTNER_INVALID_PAGE';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (select l.commission_id,l.kind,l.amount_cents,l.created_at,l.reason from public.partner_ledger_entries l join public.partner_commissions c on c.id=l.commission_id where p_partner is null or c.partner_id=p_partner order by l.created_at desc,l.id desc offset p_offset limit 100) r),'[]');
end $$;
-- Worker RPCs: server credentials only; cron tokens expire and are single-use.
create function public.partner_finance_sources() returns jsonb language plpgsql security definer set search_path='' as $$
declare cursor_pos integer;n integer;result jsonb;begin
 perform public.partner_finance_assert();
 select finance_cursor into cursor_pos from public.partner_config for update;
 select count(*) into n from public.subscriptions s join public.partner_attributions a on a.user_id=s.user_id where a.partner_id is not null and s.provider_subscription_id is not null;
 if n=0 then return '[]'::jsonb;end if;
 cursor_pos:=cursor_pos%n;
 select coalesce(jsonb_agg(jsonb_build_object('subscription_id',s.id,'provider_id',s.provider_subscription_id,'partner_id',s.partner_id,'historical_invoices',coalesce((select jsonb_agg(distinct b.provider_resource_id) from public.billing_events b where b.subscription_id=s.id and b.event_type='subscription_authorized_payment' and b.effect='payment_approved'),'[]'))),'[]') into result
 from (select sub.*,a.partner_id from public.subscriptions sub join public.partner_attributions a on a.user_id=sub.user_id where a.partner_id is not null and sub.provider_subscription_id is not null order by sub.id offset cursor_pos limit 20) s;
 update public.partner_config set finance_cursor=case when cursor_pos+20>=n then 0 else cursor_pos+20 end;
 return result;
end $$;
create function public.partner_finance_source_failed(p_subscription uuid) returns void language plpgsql security definer set search_path='' as $$declare partner uuid;c record;begin
 perform public.partner_finance_assert();
 select a.partner_id into partner from public.partner_attributions a join public.subscriptions s on s.user_id=a.user_id where s.id=p_subscription;
 if partner is null then return;end if;
 perform public.partner_finance_lock(partner);
 update public.partner_financial_payments set history_complete=false where subscription_id=p_subscription;
 for c in select cm.id from public.partner_commissions cm join public.partner_financial_payments p on p.id=cm.payment_id where p.subscription_id=p_subscription loop perform public.partner_refresh_commission(c.id);end loop;
end $$;
create function public.partner_finance_status_changed() returns trigger language plpgsql security definer set search_path='' as $$declare c record;begin
 if new.status<>old.status and new.status<>'active' then
  perform public.partner_finance_lock(new.id);
  perform public.partner_cancel_reserved_payouts(new.id,'PARTNER_INACTIVE');
  for c in select id from public.partner_commissions where partner_id=new.id loop perform public.partner_refresh_commission(c.id);end loop;
 end if;return new;
end $$;
create trigger partner_finance_status after update of status on public.partners for each row execute function public.partner_finance_status_changed();
create function public.consume_partner_finance_invocation(p_token text) returns boolean language plpgsql security definer set search_path='' as $$declare n integer;begin
 perform public.partner_finance_assert();update public.partner_finance_invocations set used_at=statement_timestamp() where token_hash=sha256(convert_to(p_token,'UTF8')) and used_at is null and expires_at>statement_timestamp();get diagnostics n=row_count;return n=1;end $$;
create function public.dispatch_partner_finance_test() returns jsonb language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid();rid bigint;begin
 if not exists(select 1 from public.partner_config where finance_enabled and enabled) then return jsonb_build_object('outcome','disabled');end if;
 perform public.partner_finance_assert();delete from public.partner_finance_invocations where expires_at<statement_timestamp()-interval '1 day';
 insert into public.partner_finance_invocations values(sha256(convert_to(token::text,'UTF8')),statement_timestamp()+interval '2 minutes',null);
 select net.http_post(url:='https://fsbqpyyprtymwrmzsacp.supabase.co/functions/v1/partner-finance-worker',headers:=jsonb_build_object('Content-Type','application/json','x-pepday-invocation-token',token),body:='{}'::jsonb,timeout_milliseconds:=60000) into rid;
 return jsonb_build_object('outcome','requested','request_id',rid);
end $$;
do $$declare r record;begin
 for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('partner_ledger_immutable','partner_finance_assert','partner_finance_entry','partner_finance_lock','partner_refresh_commission','partner_cancel_reserved_payouts','partner_ingest_payment','partner_release_commissions','admin_prepare_partner_finance','admin_partner_finance_action','admin_partner_finance','partner_finance_sources','partner_finance_source_failed','consume_partner_finance_invocation','dispatch_partner_finance_test','partner_finance_status_changed') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);end loop;
end $$;
grant execute on function public.partner_ingest_payment(uuid,jsonb),public.partner_release_commissions(uuid),public.partner_finance_sources(),public.partner_finance_source_failed(uuid),public.consume_partner_finance_invocation(text) to service_role;
revoke all on function public.admin_partner_finance_ledger(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_prepare_partner_finance(uuid,jsonb),public.admin_partner_finance_action(uuid,jsonb,uuid),public.admin_partner_finance(uuid),public.admin_partner_finance_ledger(uuid,integer) to authenticated;
select cron.schedule('pepday-partner-finance-test','*/5 * * * *','select public.dispatch_partner_finance_test();');
commit;
