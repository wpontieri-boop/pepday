-- Additive correction: incomplete history invalidates the whole attribution.
begin;
do $$begin if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'PARTNERS_TEST_ONLY';end if;end $$;
create or replace function public.partner_ingest_payment(p_subscription uuid,p_payment jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if history then update public.partner_financial_payments set history_complete=true,first_payment_id=earliest where attribution_id=a.id;else update public.partner_financial_payments set history_complete=false where attribution_id=a.id;end if;
 update public.partner_commissions set release_at=paid+interval '30 days' where payment_id=pid and release_at is null;
 for c in select id from public.partner_commissions where attribution_id=a.id loop perform public.partner_refresh_commission(c.id);end loop;
 return jsonb_build_object('outcome','reconciled','payment_id',pid);
end $$;
commit;
