-- TEST fsbqpyyprtymwrmzsacp | 2026-10-10
-- LIVE SOURCE SNAPSHOT ONLY. NOT A MIGRATION. DO NOT RUN.
-- Functions are already deployed in TEST; this snapshot omits tables, triggers, RLS and grants.

-- admin_partner_document_access
CREATE OR REPLACE FUNCTION public.admin_partner_document_access(p_document uuid, p_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.partner_documents;token uuid:=gen_random_uuid();partner uuid;begin
 perform public.partner_finance_assert();perform public.partner_admin_assert(true,true);
 select partner_id into strict partner from public.partner_documents where id=p_document;perform public.partner_finance_lock(partner);
 select * into strict d from public.partner_documents where id=p_document for update;
 if p_operation is null or p_operation not in ('upload','download') or d.access_actor is distinct from auth.uid() or d.access_session is distinct from (auth.jwt()->>'session_id')::uuid or d.access_operation is distinct from p_operation or d.access_expires is null or d.access_expires<=statement_timestamp() then raise exception 'PARTNER_DOCUMENT_ACCESS_DENIED' using errcode='42501';end if;
 if (p_operation='upload' and d.stored_at is not null) or (p_operation='download' and d.stored_at is null) or (d.operation_expires>statement_timestamp()) then raise exception 'PARTNER_DOCUMENT_ACCESS_DENIED';end if;
 update public.partner_documents set operation_hash=sha256(convert_to(token::text,'UTF8')),operation_expires=now()+interval '2 minutes',access_expires=null where id=d.id;
 insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_document_'||p_operation,jsonb_build_object('partner_id',d.partner_id,'document_id',d.id));
 return jsonb_build_object('path',d.object_path,'sha256',d.sha256,'size_bytes',d.size_bytes,'mime_type',d.mime_type,'operation_token',token);
end $function$
;

-- admin_partner_finance_action
CREATE OR REPLACE FUNCTION public.admin_partner_finance_action(p_partner uuid, p_payload jsonb, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not public.partner_fiscal_ready(p_partner) then raise exception 'PARTNER_FISCAL_PENDING';end if;
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
  update public.partner_payouts set fiscal_version=(select version from public.partner_fiscal_reviews where partner_id=p_partner),fiscal_state='pending' where id=pid;
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
   if not public.partner_batch_fiscal_ready(batch.id) then raise exception 'PARTNER_FISCAL_PENDING';end if;
   reference:=trim(coalesce(p_payload->>'reference',''));stamp:=(p_payload->>'paid_at')::timestamptz;
   if length(reference) not between 3 and 120 or reference~*'(https?://|@)' or coalesce(p_payload->>'proof_sha256','')!~'^[a-f0-9]{64}$' or p_payload->>'amount_cents' is null or (p_payload->>'amount_cents')::bigint<>batch.net_cents or stamp is null or stamp<batch.created_at or stamp>statement_timestamp()+interval '5 minutes' then raise exception 'PARTNER_PRIVATE_PROOF_REQUIRED';end if;
   if not exists(select 1 from public.partner_documents d where d.id=(p_payload->>'proof_document_id')::uuid and d.partner_id=p_partner and d.payout_id=batch.id and d.document_type='payout_proof' and d.state='approved' and d.stored_at is not null and d.sha256=p_payload->>'proof_sha256') then raise exception 'PARTNER_PRIVATE_PROOF_REQUIRED';end if;
   for item in select i.* from public.partner_payout_items i where i.payout_id=batch.id order by i.commission_id loop
    select * into strict c from public.partner_commissions where id=item.commission_id for update;
    if c.state<>'reserved' or c.reserved_cents<>item.amount_cents or c.earned_cents-c.paid_cents<item.amount_cents or not exists(select 1 from public.partner_financial_payments p where p.id=c.payment_id and p.reconciled_at>statement_timestamp()-interval '15 minutes' and p.state in ('approved','refunded')) then raise exception 'PARTNER_RECONCILIATION_REQUIRED';end if;
    update public.partner_commissions set paid_cents=paid_cents+item.amount_cents,reserved_cents=0,state='paid',version=version+1 where id=c.id;
    perform public.partner_finance_entry(c.id,'paid',item.amount_cents,'paid:'||batch.id||':'||c.id,'MANUAL_PAYOUT_CONFIRMED');
   end loop;
   update public.partner_payouts set state='paid',paid_at=stamp,reference_private=reference,proof_document_id=(p_payload->>'proof_document_id')::uuid,proof_sha256=p_payload->>'proof_sha256',reason=action_reason where id=batch.id;
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
end $function$
;

-- admin_partner_fiscal
CREATE OR REPLACE FUNCTION public.admin_partner_fiscal(p_partner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare level text;f public.partner_fiscal_reviews;begin
 perform public.partner_finance_assert();level:=public.partner_admin_assert(false,false);
 select * into f from public.partner_fiscal_reviews where partner_id=p_partner;
 return jsonb_build_object('can_manage',level='owner','kind',(select fiscal_kind from public.partner_private_profiles where partner_id=p_partner),'state',coalesce(f.state,'pending'),'ready',public.partner_fiscal_ready(p_partner),'reason',f.reason,
 'configuration',case when level='owner' then jsonb_build_object('fiscal_document_required',f.fiscal_document_required,'accounting_reference',f.accounting_reference_private,'legal_reference',f.legal_reference_private,'retention',f.retention) else null end,
 'documents',case when level='owner' then coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'payout_id',d.payout_id,'document_type',d.document_type,'state',d.state,'stored',d.stored_at is not null,'sha256',d.sha256,'reason',d.reason)) from public.partner_documents d where d.partner_id=p_partner),'[]') else '[]' end,
 'payouts',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'state',b.fiscal_state,'payout_state',b.state,'gross_cents',b.total_cents,'withheld_cents',b.withheld_cents,'net_cents',b.net_cents,'ready',public.partner_batch_fiscal_ready(b.id),'configuration',case when level='owner' then jsonb_build_object('withholdings',b.withholding_private,'accounting_reference',b.fiscal_reference_private,'reason',b.fiscal_reason) else null end)) from public.partner_payouts b where b.partner_id=p_partner),'[]'));
end $function$
;

-- admin_partner_fiscal_action
CREATE OR REPLACE FUNCTION public.admin_partner_fiscal_action(p_partner uuid, p_payload jsonb, p_ticket uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare op text:=p_payload->>'action';why text:=trim(coalesce(p_payload->>'reason',''));n integer;p public.partner_private_profiles;f public.partner_fiscal_reviews;b public.partner_payouts;d public.partner_documents;docid uuid;tax jsonb;total bigint:=0;rules jsonb;s text;
begin
 perform public.partner_finance_assert();perform public.partner_admin_assert(true,true);perform public.partner_finance_lock(p_partner);
 if op not in ('fiscal_profile','fiscal_batch','document_create','document_review','document_access') or length(why) not between 3 and 200 or why~*'(@|https?://|[0-9]{11})' then raise exception 'PARTNER_INVALID_FISCAL_ACTION';end if;
 update public.partner_finance_tickets set used_at=statement_timestamp() where id=p_ticket and actor_id=auth.uid() and session_id=(auth.jwt()->>'session_id')::uuid and partner_id=p_partner and used_at is null and expires_at>statement_timestamp() and payload_hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 get diagnostics n=row_count;if n<>1 then raise exception 'PARTNER_STEPUP_INVALID' using errcode='42501';end if;
 select * into strict p from public.partner_private_profiles where partner_id=p_partner;
 select * into f from public.partner_fiscal_reviews where partner_id=p_partner;
 if op='fiscal_profile' then
  s:=p_payload->>'state';rules:=p_payload->'retention';
  if s is null or s not in ('pending','approved','divergent') or p.fiscal_kind is null or jsonb_typeof(rules) is distinct from 'object' or octet_length(rules::text)>2400 then raise exception 'PARTNER_INVALID_FISCAL_ACTION';end if;
  if s='approved' and (jsonb_typeof(p_payload->'fiscal_document_required') is distinct from 'boolean' or length(trim(coalesce(p_payload->>'accounting_reference','')))<3 or length(trim(coalesce(p_payload->>'legal_reference','')))<3 or not public.partner_retention_valid(rules)) then raise exception 'PARTNER_FISCAL_PENDING';end if;
  if length(coalesce(p_payload->>'accounting_reference',''))>120 or length(coalesce(p_payload->>'legal_reference',''))>120 then raise exception 'PARTNER_INVALID_FISCAL_ACTION';end if;
  perform public.partner_cancel_reserved_payouts(p_partner,'FISCAL_PROFILE_CHANGED');
  insert into public.partner_fiscal_reviews(partner_id,state,profile_version,fiscal_document_required,accounting_reference_private,legal_reference_private,retention,reason,reviewed_by,reviewed_at)
  values(p_partner,s,p.version,(p_payload->>'fiscal_document_required')::boolean,trim(p_payload->>'accounting_reference'),trim(p_payload->>'legal_reference'),rules,why,auth.uid(),now())
  on conflict(partner_id) do update set state=excluded.state,profile_version=excluded.profile_version,fiscal_document_required=excluded.fiscal_document_required,accounting_reference_private=excluded.accounting_reference_private,legal_reference_private=excluded.legal_reference_private,retention=excluded.retention,reason=excluded.reason,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,version=public.partner_fiscal_reviews.version+1;
  -- A changed retention/contract policy requires a new contract review.
  update public.partner_documents set state='pending',reason='FISCAL_PROFILE_CHANGED' where partner_id=p_partner and document_type='contract';
 elsif op='fiscal_batch' then
  select * into strict b from public.partner_payouts where id=(p_payload->>'payout_id')::uuid and partner_id=p_partner and state='reserved' for update;
  s:=p_payload->>'state';
  if s is null or s not in ('pending','approved','divergent') or jsonb_typeof(p_payload->'withholdings') is distinct from 'array' or jsonb_array_length(p_payload->'withholdings')>12 then raise exception 'PARTNER_INVALID_FISCAL_ACTION';end if;
  for tax in select value from jsonb_array_elements(p_payload->'withholdings') loop
   if length(trim(coalesce(tax->>'tax','')))<2 or length(trim(coalesce(tax->>'basis','')))<3 or coalesce(tax->>'amount_cents','')!~'^[0-9]{1,12}$' then raise exception 'PARTNER_INVALID_WITHHOLDING';end if;
   total:=total+(tax->>'amount_cents')::bigint;
  end loop;
  if total>b.total_cents or (total=0 and p_payload->>'no_withholding_confirmed' is distinct from 'true') then raise exception 'PARTNER_INVALID_WITHHOLDING';end if;
  if s='approved' and (not public.partner_fiscal_ready(p_partner) or b.fiscal_version<>f.version or length(trim(coalesce(p_payload->>'accounting_reference','')))<3) then raise exception 'PARTNER_FISCAL_PENDING';end if;
  if length(coalesce(p_payload->>'accounting_reference',''))>120 then raise exception 'PARTNER_INVALID_FISCAL_ACTION';end if;
  update public.partner_payouts set fiscal_state=s,withheld_cents=total,net_cents=total_cents-total,withholding_private=p_payload->'withholdings',fiscal_reason=why,fiscal_reference_private=trim(p_payload->>'accounting_reference') where id=b.id;
 elsif op='document_create' then
  if p_payload->>'document_type' not in ('contract','fiscal','receipt','payout_proof') or p_payload->>'document_type' is null then raise exception 'PARTNER_INVALID_DOCUMENT';end if;
  if p_payload->>'payout_id' is not null then
   select * into strict b from public.partner_payouts where id=(p_payload->>'payout_id')::uuid and partner_id=p_partner and state='reserved' for update;
  end if;
  if (p_payload->>'document_type'='contract' and b.id is not null) or (p_payload->>'document_type'<>'contract' and b.id is null) then raise exception 'PARTNER_INVALID_DOCUMENT_SCOPE';end if;
  docid:=gen_random_uuid();
  insert into public.partner_documents(id,partner_id,payout_id,document_type,object_path,sha256,mime_type,size_bytes,profile_version,retention_snapshot,created_by,reason,access_actor,access_session,access_operation,access_expires)
  values(docid,p_partner,b.id,p_payload->>'document_type',p_partner||'/'||docid,p_payload->>'sha256',p_payload->>'mime_type',(p_payload->>'size_bytes')::integer,p.version,coalesce(f.retention->(p_payload->>'document_type'),'{}'),auth.uid(),why,auth.uid(),(auth.jwt()->>'session_id')::uuid,'upload',now()+interval '5 minutes');
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_document_prepared',jsonb_build_object('partner_id',p_partner,'document_id',docid));
  insert into public.partner_fiscal_events(partner_id,actor_user_id,action,reason,evidence_private) values(p_partner,auth.uid(),op,why,jsonb_build_object('document_id',docid,'payload',p_payload));
  return jsonb_build_object('id',docid,'state','pending');
 else
  select * into strict d from public.partner_documents where id=(p_payload->>'document_id')::uuid and partner_id=p_partner for update;
  if op='document_review' then
   s:=p_payload->>'state';
   if s is null or s not in ('pending','approved','divergent') then raise exception 'PARTNER_INVALID_DOCUMENT';end if;
   if s='approved' and (d.stored_at is null or d.profile_version<>p.version or not public.partner_retention_valid(f.retention)) then raise exception 'PARTNER_DOCUMENT_PENDING';end if;
   if d.payout_id is not null and not exists(select 1 from public.partner_payouts where id=d.payout_id and state='reserved') then raise exception 'PARTNER_PAYOUT_NOT_RESERVED';end if;
   if d.state='approved' and s<>'approved' then perform public.partner_cancel_reserved_payouts(p_partner,'DOCUMENT_REVIEW_CHANGED');end if;
   update public.partner_documents set state=s,reason=why,reviewed_at=now(),retention_snapshot=coalesce(f.retention->d.document_type,'{}') where id=d.id;
  else
   s:=p_payload->>'operation';
   if s is null or s not in ('upload','download') or (s='upload' and d.stored_at is not null) or (s='download' and d.stored_at is null) then raise exception 'PARTNER_INVALID_DOCUMENT';end if;
   update public.partner_documents set access_actor=auth.uid(),access_session=(auth.jwt()->>'session_id')::uuid,access_operation=s,access_expires=now()+interval '5 minutes' where id=d.id;
  end if;
 end if;
 insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_'||op,jsonb_build_object('partner_id',p_partner,'payout_id',b.id,'document_id',d.id,'state',s,'reason',why));
 insert into public.partner_fiscal_events(partner_id,actor_user_id,action,reason,evidence_private) values(p_partner,auth.uid(),op,why,jsonb_build_object('before_profile',to_jsonb(f),'before_batch',to_jsonb(b)-'recipient_snapshot'-'reference_private'-'proof_sha256','before_document',jsonb_build_object('id',d.id,'state',d.state),'payload',p_payload));
 return jsonb_build_object('outcome',op,'state',s);
end $function$
;

-- admin_prepare_partner_finance
CREATE OR REPLACE FUNCTION public.admin_prepare_partner_finance(p_partner uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proof jsonb;pwd boolean:=false;totp boolean:=false;ticket uuid;
begin
 perform public.partner_finance_assert();perform public.partner_admin_assert(true,true);
 if jsonb_typeof(p_payload) is distinct from 'object' or coalesce(p_payload->>'action','') not in ('reserve','cancel','confirm','resolve','approve','settle_debt','recipient','fiscal_profile','fiscal_batch','document_create','document_review','document_access') or octet_length(p_payload::text)>4096 or not exists(select 1 from public.partners where id=p_partner) then raise exception 'PARTNER_INVALID_FINANCE_ACTION';end if;
 for proof in select value from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) loop
  if (proof->>'timestamp')~'^[0-9]+$' and (proof->>'timestamp')::numeric between extract(epoch from statement_timestamp())-300 and extract(epoch from statement_timestamp())+5 then pwd:=pwd or proof->>'method'='password';totp:=totp or proof->>'method'='totp';end if;
 end loop;
 if not pwd or not totp then raise exception 'PARTNER_RECENT_PASSWORD_TOTP_REQUIRED' using errcode='42501';end if;
 insert into public.partner_finance_tickets(actor_id,session_id,partner_id,payload_hash,expires_at)
 values(auth.uid(),(auth.jwt()->>'session_id')::uuid,p_partner,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),statement_timestamp()+interval '5 minutes') returning id into ticket;
 return ticket;
end $function$
;

-- partner_batch_fiscal_ready
CREATE OR REPLACE FUNCTION public.partner_batch_fiscal_ready(p_payout uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.partner_payouts b join public.partner_fiscal_reviews f on f.partner_id=b.partner_id
 where b.id=p_payout and public.partner_fiscal_ready(b.partner_id) and b.fiscal_state='approved' and b.fiscal_version=f.version
 and b.withheld_cents is not null and b.net_cents is not null and length(b.fiscal_reference_private)>=3
 and not exists(select 1 from unnest(case when f.fiscal_document_required then array['receipt','payout_proof','fiscal'] else array['receipt','payout_proof'] end) t
 where not exists(select 1 from (select * from public.partner_documents where payout_id=b.id and partner_id=b.partner_id and document_type=t order by created_at desc,id desc limit 1) d where d.state='approved' and d.stored_at is not null and d.profile_version=f.profile_version)));
$function$
;

-- partner_document_complete
CREATE OR REPLACE FUNCTION public.partner_document_complete(p_document uuid, p_token text, p_sha256 text, p_size integer, p_mime text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.partner_documents;partner uuid;begin
 perform public.partner_finance_assert();select partner_id into strict partner from public.partner_documents where id=p_document;perform public.partner_finance_lock(partner);
 select * into strict d from public.partner_documents where id=p_document for update;
 if d.operation_hash is distinct from sha256(convert_to(p_token,'UTF8')) or d.operation_expires is null or d.operation_expires<=now() or d.sha256 is distinct from p_sha256 or d.size_bytes is distinct from p_size or d.mime_type is distinct from p_mime then raise exception 'PARTNER_DOCUMENT_INTEGRITY_FAILED';end if;
 if not exists(select 1 from public.admin_memberships m join auth.sessions s on s.user_id=m.user_id where m.user_id=d.access_actor and m.access_level='owner' and m.active and m.password_configured and s.id=d.access_session and s.created_at>statement_timestamp()-interval '8 hours' and (s.not_after is null or s.not_after>statement_timestamp()) and exists(select 1 from auth.mfa_factors x where x.user_id=m.user_id and x.status='verified' and x.factor_type='totp')) then raise exception 'PARTNER_DOCUMENT_ACCESS_DENIED';end if;
 update public.partner_documents set stored_at=case when access_operation='upload' then now() else stored_at end,operation_hash=null,operation_expires=null where id=d.id;
 return true;
end $function$
;

-- partner_document_valid
CREATE OR REPLACE FUNCTION public.partner_document_valid(p_document text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare d text:=upper(p_document); total integer; digit integer; i integer; j integer; weight integer;
begin
  if d is null or d ~ '^([0-9])\1+$' then return false; end if;
  if d ~ '^[0-9]{11}$' then
    for j in 10..11 loop
      total:=0;
      for i in 1..j-1 loop total:=total+substr(d,i,1)::integer*(j+1-i); end loop;
      digit:=(total*10)%11; if digit=10 then digit:=0; end if;
      if digit<>substr(d,j,1)::integer then return false; end if;
    end loop;
    return true;
  elsif d ~ '^[A-Z0-9]{12}[0-9]{2}$' then
    for j in 13..14 loop
      total:=0; weight:=2;
      for i in reverse j-1..1 loop
        total:=total+(ascii(substr(d,i,1))-48)*weight;
        weight:=case when weight=9 then 2 else weight+1 end;
      end loop;
      digit:=case when total%11<2 then 0 else 11-total%11 end;
      if digit<>substr(d,j,1)::integer then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $function$
;

-- partner_fiscal_event_immutable
CREATE OR REPLACE FUNCTION public.partner_fiscal_event_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
 if tg_op='UPDATE' and new.actor_user_id is null and old.actor_user_id is not null and (to_jsonb(new)-'actor_user_id')=(to_jsonb(old)-'actor_user_id') then return new;end if;
 raise exception 'PARTNER_FISCAL_AUDIT_APPEND_ONLY';end $function$
;

-- partner_fiscal_ready
CREATE OR REPLACE FUNCTION public.partner_fiscal_ready(p_partner uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.partner_fiscal_reviews f join public.partner_private_profiles p on p.partner_id=f.partner_id
 where f.partner_id=p_partner and f.state='approved' and f.profile_version=p.version and p.fiscal_kind in ('CPF','CNPJ')
 and f.fiscal_document_required is not null and length(f.accounting_reference_private)>=3 and length(f.legal_reference_private)>=3
 and public.partner_retention_valid(f.retention)
 and exists(select 1 from (select * from public.partner_documents where partner_id=p_partner and document_type='contract' and payout_id is null order by created_at desc,id desc limit 1) d where d.state='approved' and d.stored_at is not null and d.profile_version=p.version));
$function$
;

-- partner_retention_valid
CREATE OR REPLACE FUNCTION public.partner_retention_valid(p_rules jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$declare t text;r jsonb;begin
 if jsonb_typeof(p_rules) is distinct from 'object' then return false;end if;
 foreach t in array array['contract','fiscal','receipt','payout_proof'] loop
 r:=p_rules->t;
 if r is null or r->>'validated' is distinct from 'true' or length(trim(coalesce(r->>'legal_basis','')))<3 or length(trim(coalesce(r->>'start_event','')))<3 then return false;end if;
 if r->>'months' is not null and ((r->>'months')!~'^[0-9]{1,4}$' or (r->>'months')::integer<1) then return false;end if;
 end loop;return true;
end $function$
;
