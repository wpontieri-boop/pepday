-- TEST-only synthetic CPF classification and fiscal guards. NEVER a migration.
-- 00000000000 is deliberately INVALID: structural CPF fixture, not a real CPF.
-- Uses OWNER ID read-only and a rollback-only synthetic session/claims, never password/MFA.
begin;
set local statement_timeout='30s';
do $qa$
declare owner_id uuid;sid uuid:=gen_random_uuid();pid uuid:=gen_random_uuid();bid uuid:=gen_random_uuid();
 client_id uuid:=gen_random_uuid();intent uuid:=gen_random_uuid();rule uuid;attr uuid;sub uuid;cid uuid;
 claims jsonb;data jsonb;payload jsonb;ticket uuid;doc uuid;rules jsonb;before_reason text;
begin
 perform public.partner_finance_assert();
 select user_id into strict owner_id from public.admin_memberships where access_level='owner' and active;
 insert into auth.sessions(id,user_id,created_at) values(sid,owner_id,statement_timestamp());
 claims:=jsonb_build_object('sub',owner_id,'iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','aal','aal2','session_id',sid,'amr',
 jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from statement_timestamp())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from statement_timestamp())::bigint)));
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',claims::text,true);
 insert into public.partners(id,public_name,partner_type,slug,public_code,status) values(pid,'CPF QA isolado','loja','cpf-qa-'||pid,upper(left(replace(pid::text,'-',''),8)),'active');
 insert into public.partner_private_profiles(partner_id,legal_name,document,email,pix_type,pix_key,payee_name,version,verified_at)
 values(pid,'IDENTIDADE INVALIDA SINTETICA','00000000000','qa@example.invalid','random',gen_random_uuid()::text,'QA sintético',1,now());
 data:=public.admin_partner_fiscal(pid);
 if data->>'kind'<>'CPF' or data->>'state'<>'pending' or data->>'ready'<>'false' then raise exception 'QA initial CPF/pending/blocked';end if;
 if (data->'documents')<>'[]'::jsonb or (data->'payouts')<>'[]'::jsonb then raise exception 'QA isolation';end if;
 if public.partner_fiscal_ready(pid) then raise exception 'QA no contract ready';end if;
 -- Missing legal/accounting decisions cannot approve.
 payload:=jsonb_build_object('action','fiscal_profile','state','approved','retention','{}'::jsonb,'reason','QA aprovação bloqueada');
 ticket:=public.admin_prepare_partner_finance(pid,payload);
 begin perform public.admin_partner_fiscal_action(pid,payload,ticket);raise exception 'QA unsafe profile approval';
 exception when others then if sqlerrm<>'PARTNER_FISCAL_PENDING' then raise;end if;end;
 -- Pending profile may be recorded without inventing a fiscal conclusion.
 payload:=jsonb_build_object('action','fiscal_profile','state','pending','retention','{}'::jsonb,'reason','QA pendente sem parecer');
 ticket:=public.admin_prepare_partner_finance(pid,payload);perform public.admin_partner_fiscal_action(pid,payload,ticket);
 if public.partner_fiscal_ready(pid) then raise exception 'QA pending readiness';end if;
 begin perform public.admin_partner_fiscal_action(pid,payload,ticket);raise exception 'QA replay accepted';
 exception when others then if sqlerrm<>'PARTNER_STEPUP_INVALID' then raise;end if;end;
 -- Structurally complete test policy is NOT legal advice and sets no period/rate.
 select jsonb_object_agg(t,jsonb_build_object('validated',true,'legal_basis','SYNTHETIC QA NOT A LEGAL OPINION','start_event','SYNTHETIC QA EVENT')) into rules
 from unnest(array['contract','fiscal','receipt','payout_proof']) t;
 if public.partner_retention_valid('{}'::jsonb) or public.partner_retention_valid(rules||jsonb_build_object('contract',jsonb_build_object('validated',true,'legal_basis','QA only','start_event','QA only','months',0))) then raise exception 'QA invalid retention accepted';end if;
 -- A configured profile still needs a STORED and APPROVED contract.
 payload:=jsonb_build_object('action','fiscal_profile','state','approved','fiscal_document_required',false,'accounting_reference','QA ONLY NOT ACCOUNTING APPROVAL','legal_reference','QA ONLY NOT LEGAL APPROVAL','retention',rules,'reason','QA teste estrutural');
 ticket:=public.admin_prepare_partner_finance(pid,payload);perform public.admin_partner_fiscal_action(pid,payload,ticket);
 if public.partner_fiscal_ready(pid) then raise exception 'QA missing contract bypass';end if;
 payload:=jsonb_build_object('action','document_create','document_type','contract','sha256',repeat('a',64),'mime_type','image/png','size_bytes',9,'reason','QA metadados sem upload');
 ticket:=public.admin_prepare_partner_finance(pid,payload);data:=public.admin_partner_fiscal_action(pid,payload,ticket);doc:=(data->>'id')::uuid;
 payload:=jsonb_build_object('action','document_review','document_id',doc,'state','approved','reason','QA sem arquivo armazenado');
 ticket:=public.admin_prepare_partner_finance(pid,payload);
 begin perform public.admin_partner_fiscal_action(pid,payload,ticket);raise exception 'QA unstored approval';
 exception when others then if sqlerrm<>'PARTNER_DOCUMENT_PENDING' then raise;end if;end;
 -- No upload/download/Storage calls. Wrong scope rejected.
 payload:=jsonb_build_object('action','document_create','document_type','fiscal','sha256',repeat('a',64),'mime_type','image/png','size_bytes',9,'reason','QA lote ausente');
 ticket:=public.admin_prepare_partner_finance(pid,payload);
 begin perform public.admin_partner_fiscal_action(pid,payload,ticket);raise exception 'QA fiscal missing batch';
 exception when others then if sqlerrm<>'PARTNER_INVALID_DOCUMENT_SCOPE' then raise;end if;end;
 -- Fully aged synthetic canonical payment is kept pending by fiscal guard.
 insert into auth.users(id,email) values(client_id,'cpf-qa-'||client_id||'@example.invalid');
 select id into sub from public.subscriptions where user_id=client_id;
 insert into public.partner_commission_rules(partner_id,version,commission_percent) values(pid,1,10) returning id into rule;
 insert into public.partner_referral_intents(id,partner_id,token_hash,source,created_at,expires_at,consumed_at)
 values(intent,pid,encode(sha256(convert_to(intent::text,'UTF8')),'hex'),'link',now()-interval '40 days',now()-interval '10 days',now()-interval '39 days');
 insert into public.partner_attributions(user_id,partner_id,rule_id,rule_version,commission_percent,intent_id,source,locked_at)
 values(client_id,pid,rule,1,10,intent,'link',now()-interval '39 days') returning id into attr;
 perform public.partner_ingest_payment(sub,jsonb_build_object('id','cpf-qa-'||client_id,'invoice_id','qa-invoice-'||client_id,'plan','monthly','currency','BRL','gross_cents',100,'refunded_cents',0,'paid_at',now()-interval '31 days','updated_at',now(),'state','approved','live_mode',false,'history_complete',true,'first_payment_id','cpf-qa-'||client_id));
 select id into strict cid from public.partner_commissions where attribution_id=attr;
 if public.partner_release_commissions(pid)<>0 or (select state from public.partner_commissions where id=cid)='released' then raise exception 'QA fiscal release bypass';end if;
 payload:=jsonb_build_object('action','reserve','request_id',gen_random_uuid(),'reason','QA sem contrato validado');ticket:=public.admin_prepare_partner_finance(pid,payload);
 begin perform public.admin_partner_finance_action(pid,payload,ticket);raise exception 'QA reserve bypass';
 exception when others then if sqlerrm<>'PARTNER_FISCAL_PENDING' then raise;end if;end;
 -- Rollback-only batch to exercise confirmation guard without transferring funds.
 insert into public.partner_payouts(id,partner_id,request_id,state,total_cents,recipient_snapshot,reason)
 values(bid,pid,gen_random_uuid(),'reserved',10,jsonb_build_object('version',1),'QA lote isolado');
 if public.partner_batch_fiscal_ready(bid) then raise exception 'QA batch no docs ready';end if;
 payload:=jsonb_build_object('action','confirm','payout_id',bid,'reason','QA confirmação bloqueada');ticket:=public.admin_prepare_partner_finance(pid,payload);
 begin perform public.admin_partner_finance_action(pid,payload,ticket);raise exception 'QA confirm bypass';
 exception when others then if sqlerrm<>'PARTNER_FISCAL_PENDING' then raise;end if;end;
 if (select state from public.partner_payouts where id=bid)<>'reserved' then raise exception 'QA batch changed after rejection';end if;
 -- AAL1, stale step-up and revoked session fail without changing real Auth.
 perform set_config('request.jwt.claims',(claims||'{"aal":"aal1"}')::text,true);
 begin perform public.admin_partner_fiscal(pid);raise exception 'QA AAL1 accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',(claims||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from statement_timestamp()-interval '10 minutes')::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from statement_timestamp()-interval '10 minutes')::bigint))))::text,true);
 begin perform public.admin_prepare_partner_finance(pid,payload);raise exception 'QA stale stepup accepted';
 exception when others then if sqlerrm<>'PARTNER_RECENT_PASSWORD_TOTP_REQUIRED' then raise;end if;end;
 perform set_config('request.jwt.claims',(claims||jsonb_build_object('session_id',gen_random_uuid()))::text,true);
 begin perform public.admin_partner_fiscal(pid);raise exception 'QA missing session accepted';
 exception when others then if sqlerrm<>'PARTNER_SESSION_REVOKED' then raise;end if;end;
 if has_function_privilege('anon','public.admin_partner_fiscal(uuid)','execute') or has_function_privilege('authenticated','public.partner_document_complete(uuid,text,text,integer,text)','execute') then raise exception 'QA excessive grants';end if;
end $qa$;
rollback;
select 'PASS CPF classification, pending, profile/document guards, retention validation, replay, aged commission release blocked, reservation/confirmation blocked, AAL1/stale-stepup/revoked-session/grants; ROLLBACK' as result;
