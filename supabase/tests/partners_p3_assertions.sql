-- Synthetic SQL-only fixtures. No provider calls, signup, e-mails or committed data.
begin;
do $$
declare owner_id uuid;member_id uuid:=gen_random_uuid();member_session uuid:=gen_random_uuid();session_id uuid:=gen_random_uuid();partner uuid:=gen_random_uuid();client uuid;sub uuid;intent uuid;rule uuid;attr uuid;commission uuid;batch uuid;ticket uuid;payload jsonb;payment jsonb;data jsonb;claims jsonb;n integer;scenario text;table_name text;ledger_count integer;
begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'TEST_ONLY';end if;
 update public.partner_config set enabled=true,finance_enabled=true;
 -- TEST enforces a single active OWNER. Use its ID read-only with a synthetic
 -- rollback session/claims; never change the OWNER, password or verified factor.
 select user_id into owner_id from public.admin_memberships where access_level='owner' and active limit 1;
 if owner_id is null then
  owner_id:=gen_random_uuid();insert into auth.users(id,email) values(owner_id,'p3-owner-'||owner_id||'@example.invalid');
  update public.profiles set role='admin' where id=owner_id;
  insert into public.admin_memberships(user_id,access_level,active,password_configured) values(owner_id,'owner',true,true);
  insert into auth.mfa_factors(id,user_id,status,factor_type,created_at,updated_at) values(gen_random_uuid(),owner_id,'verified','totp',now(),now());
 end if;
 insert into auth.sessions(id,user_id,created_at) values(session_id,owner_id,statement_timestamp());
 insert into auth.users(id,email) values(member_id,'p3-member-'||member_id||'@example.invalid');update public.profiles set role='admin' where id=member_id;
 insert into public.admin_memberships(user_id,access_level,active,password_configured) values(member_id,'admin',true,true);
 insert into auth.sessions(id,user_id,created_at) values(member_session,member_id,statement_timestamp());
 insert into auth.mfa_factors(id,user_id,status,factor_type,created_at,updated_at) values(gen_random_uuid(),member_id,'verified','totp',now(),now());
 claims:=jsonb_build_object('sub',owner_id,'iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','aal','aal2','session_id',session_id,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from statement_timestamp())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from statement_timestamp())::bigint)));
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',claims::text,true);
 insert into public.partners(id,public_name,partner_type,slug,public_code,status) values(partner,'P3 Sintético','loja','p3-'||partner,upper(left(replace(partner::text,'-',''),8)),'active');
 insert into public.partner_private_profiles(partner_id,legal_name,document,email,pix_type,pix_key,payee_name,verified_at,version) values(partner,'P3 Sintético','12345678909','p3-partner@example.invalid','random',gen_random_uuid()::text,'P3 Sintético',now(),1);
 insert into public.partner_commission_rules(partner_id,version,commission_percent) values(partner,1,16) returning id into rule;
 -- Every scenario owns an account/intent/payment, with immutable P2 snapshots.
 foreach scenario in array array['monthly','annual','recovery','partial','full','dispute','unknown','currency','late_first','rounding','young','paid_refund','failure','suspend','void','profile'] loop
  client:=gen_random_uuid();intent:=gen_random_uuid();
  insert into auth.users(id,email) values(client,'p3-client-'||client||'@example.invalid');
  select id into sub from public.subscriptions where user_id=client;
  insert into public.partner_referral_intents(id,partner_id,token_hash,source,created_at,expires_at,consumed_at) values(intent,partner,encode(sha256(convert_to(intent::text,'UTF8')),'hex'),'link',now()-interval '40 days',now()-interval '10 days',now()-interval '39 days');
  insert into public.partner_attributions(user_id,partner_id,rule_id,rule_version,commission_percent,intent_id,source,locked_at) values(client,partner,rule,1,case when scenario='rounding' then 12.5 else 16 end,intent,'link',now()-interval '39 days') returning id into attr;
  payment:=jsonb_build_object('id','p3-'||client,'invoice_id','i-'||client,'plan',case when scenario in ('annual','recovery') then scenario else 'monthly' end,'currency','BRL','gross_cents',case when scenario='rounding' then 4 when scenario='annual' then 9990 when scenario='recovery' then 990 else 1490 end,'refunded_cents',0,'paid_at',now()-case when scenario='young' then interval '29 days' else interval '31 days' end,'updated_at',now()-interval '1 minute','state','approved','live_mode',false,'history_complete',scenario<>'unknown','first_payment_id','p3-'||client);
  if scenario='currency' then payment:=payment||'{"currency":"USD"}';end if;
  perform public.partner_ingest_payment(sub,payment);
  select id into commission from public.partner_commissions where attribution_id=attr;
  if commission is null then raise exception 'missing commission %',scenario;end if;
  if scenario='monthly' and (select earned_cents from public.partner_commissions where id=commission)<>238 then raise exception 'monthly cents';end if;
  if scenario='annual' and (select earned_cents from public.partner_commissions where id=commission)<>1598 then raise exception 'annual cents';end if;
  if scenario='recovery' and (select earned_cents from public.partner_commissions where id=commission)<>158 then raise exception 'recovery cents';end if;
  if scenario='rounding' and (select earned_cents from public.partner_commissions where id=commission)<>1 then raise exception 'half up';end if;
  select count(*) into ledger_count from public.partner_ledger_entries where commission_id=commission;
  perform public.partner_ingest_payment(sub,payment);
  if (select count(*) from public.partner_ledger_entries where commission_id=commission)<>ledger_count then raise exception 'ingestion replay';end if;
  perform public.partner_ingest_payment(sub,payment||jsonb_build_object('id','renew-'||client,'invoice_id','renew-i-'||client,'paid_at',now()-interval '1 day'));
  if (select count(*) from public.partner_commissions where attribution_id=attr)<>1 then raise exception 'renewal commission';end if;
  if scenario in ('unknown','currency','young') then
   perform public.partner_release_commissions(partner);
   if (select state from public.partner_commissions where id=commission)='released' then raise exception 'unsafe release %',scenario;end if;
   if scenario='unknown' then
    perform public.partner_ingest_payment(sub,payment||'{"history_complete":true}');perform public.partner_release_commissions(partner);
    if (select reason from public.partner_commissions where id=commission)<>'OWNER_REVIEW_REQUIRED' then raise exception 'review auto bypass';end if;
    payload:=jsonb_build_object('action','approve','commission_id',commission,'reason','Histórico sintético conciliado');ticket:=public.admin_prepare_partner_finance(partner,payload);perform public.admin_partner_finance_action(partner,payload,ticket);perform public.partner_release_commissions(partner);
    if (select state from public.partner_commissions where id=commission)<>'released' then raise exception 'documented review not released';end if;
   end if;
  elsif scenario in ('partial','full','dispute','late_first') then
   if scenario='partial' then payment:=payment||'{"refunded_cents":745,"state":"refunded"}';
   elsif scenario='full' then payment:=payment||'{"refunded_cents":1490,"state":"refunded"}';
   elsif scenario='dispute' then payment:=payment||'{"state":"disputed"}';
   else payment:=payment||'{"first_payment_id":"older-canonical-payment"}';end if;
   payment:=payment||jsonb_build_object('updated_at',now());perform public.partner_ingest_payment(sub,payment);
   if scenario='partial' and (select earned_cents from public.partner_commissions where id=commission)<>119 then raise exception 'partial cumulative';end if;
   if scenario='full' and (select state from public.partner_commissions where id=commission)<>'voided' then raise exception 'full void';end if;
   if scenario in ('dispute','late_first') and (select state from public.partner_commissions where id=commission)<>'review' then raise exception 'canonical review';end if;
   if scenario='dispute' then
    payload:=jsonb_build_object('action','approve','commission_id',commission,'reason','Não contornar disputa');ticket:=public.admin_prepare_partner_finance(partner,payload);
    begin perform public.admin_partner_finance_action(partner,payload,ticket);raise exception 'provider override';exception when others then if sqlerrm<>'PARTNER_CANONICAL_REVIEW_UNRESOLVED' then raise;end if;end;
   end if;
   select count(*) into ledger_count from public.partner_ledger_entries where commission_id=commission;perform public.partner_ingest_payment(sub,payment);
   if (select count(*) from public.partner_ledger_entries where commission_id=commission)<>ledger_count then raise exception 'refund replay';end if;
  elsif scenario='void' then
   payload:=jsonb_build_object('action','resolve','commission_id',commission,'reason','Anulação investigada sintética');ticket:=public.admin_prepare_partner_finance(partner,payload);perform public.admin_partner_finance_action(partner,payload,ticket);
   if (select state from public.partner_commissions where id=commission)<>'voided' then raise exception 'owner annulment';end if;
  else
   perform public.partner_release_commissions(partner);
   if (select state from public.partner_commissions where id=commission)<>'released' then raise exception 'release after thirty %',scenario;end if;
   payload:=jsonb_build_object('action','reserve','request_id',gen_random_uuid(),'reason','Reserva sintética sem transferência');ticket:=public.admin_prepare_partner_finance(partner,payload);data:=public.admin_partner_finance_action(partner,payload,ticket);batch:=(data->>'id')::uuid;
   begin perform public.admin_partner_finance_action(partner,payload,ticket);raise exception 'replay accepted';exception when others then if sqlerrm<>'PARTNER_STEPUP_INVALID' then raise;end if;end;
   ticket:=public.admin_prepare_partner_finance(partner,payload);
   if (public.admin_partner_finance_action(partner,payload,ticket)->>'id')::uuid<>batch then raise exception 'batch idempotency';end if;
   if scenario='monthly' then
    ticket:=public.admin_prepare_partner_finance(partner,payload);update public.partner_finance_tickets set expires_at=now()-interval '1 second' where id=ticket;
    begin perform public.admin_partner_finance_action(partner,payload,ticket);raise exception 'expired ticket';exception when others then if sqlerrm<>'PARTNER_STEPUP_INVALID' then raise;end if;end;
    ticket:=public.admin_prepare_partner_finance(partner,payload);
    begin perform public.admin_partner_finance_action(partner,payload||'{"reason":"alterado"}',ticket);raise exception 'tampered ticket';exception when others then if sqlerrm<>'PARTNER_STEPUP_INVALID' then raise;end if;end;
    payload:=jsonb_build_object('action','recipient','payout_id',batch,'reason','Consulta privada necessária');ticket:=public.admin_prepare_partner_finance(partner,payload);data:=public.admin_partner_finance_action(partner,payload,ticket);
    if not data?'pix_key' or data?'document' or (select count(*) from jsonb_object_keys(data))<>3 then raise exception 'recipient minimization';end if;
   end if;
   if scenario in ('failure','suspend','profile') then
    if scenario='failure' then perform public.partner_ingest_payment(sub,payment||jsonb_build_object('id','incomplete-renew-'||client,'invoice_id','incomplete-i-'||client,'paid_at',now()-interval '1 day','history_complete',false));
    elsif scenario='suspend' then update public.partners set status='suspended' where id=partner;
    else
     update public.partner_private_profiles set version=version+1 where partner_id=partner;
     payload:=jsonb_build_object('action','confirm','payout_id',batch,'reason','Confirmação sintética');ticket:=public.admin_prepare_partner_finance(partner,payload);
     begin perform public.admin_partner_finance_action(partner,payload,ticket);raise exception 'changed profile accepted';exception when others then if sqlerrm<>'PARTNER_PROFILE_CHANGED_CANCEL_BATCH' then raise;end if;end;
     payload:=jsonb_build_object('action','cancel','payout_id',batch,'reason','Cancelar perfil alterado');ticket:=public.admin_prepare_partner_finance(partner,payload);perform public.admin_partner_finance_action(partner,payload,ticket);
    end if;
    if (select state from public.partner_payouts where id=batch)<>'canceled' then raise exception 'reservation not canceled';end if;
    update public.partners set status='active' where id=partner;
   else
    payload:=jsonb_build_object('action','confirm','payout_id',batch,'reason','Registro sintético sem banco','reference','synthetic-receipt','proof_sha256',repeat('a',64),'amount_cents',(select total_cents from public.partner_payouts where id=batch),'paid_at',now());ticket:=public.admin_prepare_partner_finance(partner,payload);perform public.admin_partner_finance_action(partner,payload,ticket);
    select count(*) into ledger_count from public.partner_ledger_entries where kind='paid';ticket:=public.admin_prepare_partner_finance(partner,payload);perform public.admin_partner_finance_action(partner,payload,ticket);
    if (select count(*) from public.partner_ledger_entries where kind='paid')<>ledger_count then raise exception 'paid replay';end if;
    if scenario='paid_refund' then
     perform public.partner_ingest_payment(sub,payment||jsonb_build_object('refunded_cents',1490,'state','refunded','updated_at',now()));
     if (select state from public.partner_commissions where id=commission)<>'reversed' then raise exception 'paid reversal';end if;
     payload:=jsonb_build_object('action','reserve','request_id',gen_random_uuid(),'reason','Bloqueio de débito');ticket:=public.admin_prepare_partner_finance(partner,payload);
     begin perform public.admin_partner_finance_action(partner,payload,ticket);raise exception 'debt bypass';exception when others then if sqlerrm<>'PARTNER_PAYOUT_BLOCKED' then raise;end if;end;
     payload:=jsonb_build_object('action','settle_debt','commission_id',commission,'reason','Conciliação sintética documentada','reference','synthetic-debt-receipt','proof_sha256',repeat('b',64));ticket:=public.admin_prepare_partner_finance(partner,payload);perform public.admin_partner_finance_action(partner,payload,ticket);
     if (select debt_settled_cents from public.partner_commissions where id=commission)<>238 then raise exception 'debt reconciliation';end if;
    end if;
   end if;
  end if;
 end loop;
 -- Read projections have no customer, legal identity, PIX, receipt or token data.
 foreach scenario in array array['owner','admin','viewer'] loop
  if scenario='owner' then perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',claims::text,true);
  else update public.admin_memberships set access_level=scenario where user_id=member_id;perform set_config('request.jwt.claim.sub',member_id::text,true);perform set_config('request.jwt.claims',(claims||jsonb_build_object('sub',member_id,'session_id',member_session))::text,true);end if;
  data:=public.admin_partner_finance(partner);
  if data::text~'"(pix_key|document|user_id|recipient_snapshot|reference_private|proof_sha256|payload_hash)"\s*:' then raise exception 'financial privacy';end if;
  if (data->>'can_manage')::boolean<>(scenario='owner') then raise exception 'permissions projection';end if;
  if scenario<>'owner' then begin perform public.admin_prepare_partner_finance(partner,payload);raise exception 'non-owner finance';exception when insufficient_privilege then null;end;end if;
 end loop;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',(claims||'{"aal":"aal1"}')::text,true);
 begin perform public.admin_partner_finance(partner);raise exception 'aal1 accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',claims::text,true);
 update auth.sessions set created_at=now()-interval '9 hours' where id=session_id;
 begin perform public.admin_partner_finance(partner);raise exception 'expired accepted';exception when insufficient_privilege then null;end;
 update auth.sessions set created_at=now() where id=session_id;
 begin update public.partner_ledger_entries set amount_cents=999 where commission_id=commission;raise exception 'ledger update accepted';exception when others then if sqlerrm<>'PARTNER_LEDGER_APPEND_ONLY' then raise;end if;end;
 begin delete from public.partner_ledger_entries where commission_id=commission;raise exception 'ledger delete accepted';exception when others then if sqlerrm<>'PARTNER_LEDGER_APPEND_ONLY' then raise;end if;end;
 foreach table_name in array array['partner_financial_payments','partner_commissions','partner_ledger_entries','partner_payouts','partner_payout_items','partner_finance_tickets','partner_finance_invocations'] loop
  if has_table_privilege('anon','public.'||table_name,'SELECT') or has_table_privilege('authenticated','public.'||table_name,'SELECT') or has_table_privilege('service_role','public.'||table_name,'INSERT') then raise exception 'direct table access %',table_name;end if;
 end loop;
 if has_function_privilege('authenticated','public.partner_ingest_payment(uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.admin_partner_finance(uuid)','EXECUTE') then raise exception 'rpc access';end if;
 update public.partner_config set finance_enabled=false;
 begin perform public.admin_partner_finance(partner);raise exception 'disabled accepted';exception when others then if sqlerrm<>'PARTNER_FINANCE_DISABLED' then raise;end if;end;
end $$;
rollback;
