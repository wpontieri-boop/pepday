-- TEST-only synthetic assertions. Owner/admin IDs read only; claims are not human authentication.
begin;

do $qa$
declare owner_id uuid;sid uuid:=gen_random_uuid();pid uuid:=gen_random_uuid();pid2 uuid:=gen_random_uuid();claims jsonb;
 issued jsonb;issued2 jsonb;inv uuid;token text;token2 text;challenge jsonb;otp jsonb;r jsonb;session text;session2 text;d jsonb;v integer;ip text:=repeat('a',64);
 payload jsonb:=jsonb_build_object('kind','CPF','legal_name','QA Pessoa Fisica','document','00000000000','email','qa@example.invalid','pix_key','QA-ONLY-NOT-A-PIX');
 admin_id uuid;client_id uuid:=gen_random_uuid();intent_id uuid:=gen_random_uuid();rule_id uuid;attr_id uuid;subscription_id uuid;commission_id uuid;
 n integer;before_p1 text;after_p1 text;
begin
 select user_id into strict owner_id from public.admin_memberships where access_level='owner' and active;
 insert into auth.sessions(id,user_id,created_at) values(sid,owner_id,now());
 claims:=jsonb_build_object('sub',owner_id,'iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','aal','aal2','session_id',sid,'amr',
 jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)));
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',claims::text,true);
 insert into public.partners(id,public_name,partner_type,slug,public_code,status) values(pid,'QA Portal A','loja','qa-portal-'||pid,upper(left(replace(pid::text,'-',''),8)),'draft');
 insert into public.partners(id,public_name,partner_type,slug,public_code,status) values(pid2,'QA Portal B','loja','qa-portal-'||pid2,upper(left(replace(pid2::text,'-',''),8)),'draft');
 select md5(row_to_json(p)::text) into before_p1 from public.partners p where id=pid;
 begin perform public.admin_partner_portal(jsonb_build_object('action','issue','partner_id',pid,'email','real@real.com'));raise exception 'QA accepted real contact';exception when others then if sqlerrm<>'PORTAL_SYNTHETIC_ONLY' then raise;end if;end;
 issued:=public.admin_partner_portal(jsonb_build_object('action','issue','partner_id',pid,'email','qa@example.invalid','opt_in',true,'contact_confirmed',true));
 inv:=(issued->>'id')::uuid;token:=split_part(issued->>'link','#invite=',2);
 if length(token)<>43 or (select token_hash from partner_portal.invites where id=inv)=token then raise exception 'QA bad token storage';end if;
 r:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',token,'ip_hash',ip));challenge:=r;
 if r ? 'code' or r ? 'session' then raise exception 'QA leaked OTP or session';end if;
 otp:=public.admin_partner_portal(jsonb_build_object('action','qa_code','id',inv,'challenge',r->>'challenge'));
 r:=public.partner_portal_exchange(jsonb_build_object('action','verify','invite',token,'challenge',challenge->>'challenge','code',otp->>'code','ip_hash',ip));
 if r->>'ok'<>'true' then raise exception 'QA OTP fail';end if;session:=r->>'session';
 if length(session)<>43 then raise exception 'QA session entropy';end if;
 r:=public.partner_portal_exchange(jsonb_build_object('action','verify','invite',token,'challenge',challenge->>'challenge','code',otp->>'code','ip_hash',ip));
 if r->>'ok'<>'false' then raise exception 'QA replay OTP';end if;
 begin perform public.partner_portal_exchange(jsonb_build_object('action','view','session',token));raise exception 'QA invite alone access';exception when insufficient_privilege then null;end;
 begin perform public.partner_portal_exchange(jsonb_build_object('action','save','session',session,'data',payload||'{"document":"11111111111"}','version',0));raise exception 'QA real document';exception when others then if sqlerrm<>'PORTAL_SYNTHETIC_ONLY' then raise;end if;end;
 begin perform public.partner_portal_exchange(jsonb_build_object('action','save','session',session,'data',payload||'{"commission_percent":99}','version',0));raise exception 'QA finance injection';exception when others then if sqlerrm<>'PORTAL_SYNTHETIC_ONLY' then raise;end if;end;
 r:=public.partner_portal_exchange(jsonb_build_object('action','save','session',session,'data',payload,'version',0));
 if r#>>'{view,submission,version}'<>'1' then raise exception 'QA draft version';end if;
 begin perform public.partner_portal_exchange(jsonb_build_object('action','save','session',session,'data',payload,'version',0));raise exception 'QA stale version';exception when others then if sqlerrm<>'PORTAL_VERSION_CONFLICT' then raise;end if;end;
 -- MEI/CNPJ submissions are staging only, not P1 identities.
 payload:=payload||'{"kind":"MEI","document":"00000000000000"}';
 r:=public.partner_portal_exchange(jsonb_build_object('action','save','session',session,'data',payload,'version',1));
 payload:=payload||'{"kind":"CNPJ"}';
 r:=public.partner_portal_exchange(jsonb_build_object('action','save','session',session,'data',payload,'version',2));
 begin perform public.partner_portal_exchange(jsonb_build_object('action','accept_contract','session',session));raise exception 'QA legal bypass';exception when others then if sqlerrm<>'PORTAL_LEGAL_PENDING' then raise;end if;end;
 r:=public.partner_portal_exchange(jsonb_build_object('action','contract_seen','session',session,'version','qa-draft-1','hash',(select sha256 from partner_portal.contracts)));
 -- Document grants check account binding, immutable exact synthetic bytes and no public table access.
 begin perform public.partner_portal_exchange(jsonb_build_object('action','doc_prepare','session',session,'sha256',repeat('b',64),'size',68,'mime','image/png'));raise exception 'QA real file';exception when others then if sqlerrm<>'PORTAL_SYNTHETIC_ONLY' then raise;end if;end;
 d:=public.partner_portal_exchange(jsonb_build_object('action','doc_prepare','session',session,'sha256','1fd6daf3d23b0bc130e484733d9659da3299dd684cfad2b80cd95d8b4e5df757','size',68,'mime','image/png'));
 -- Second partner session cannot reference first partner's doc or data.
 issued2:=public.admin_partner_portal(jsonb_build_object('action','issue','partner_id',pid2,'email','b@example.invalid','opt_in',true,'contact_confirmed',true));
 token2:=split_part(issued2->>'link','#invite=',2);
 challenge:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',token2,'ip_hash',repeat('b',64)));
 otp:=public.admin_partner_portal(jsonb_build_object('action','qa_code','id',issued2->>'id','challenge',challenge->>'challenge'));
 r:=public.partner_portal_exchange(jsonb_build_object('action','verify','invite',token2,'challenge',challenge->>'challenge','code',otp->>'code','ip_hash',repeat('b',64)));session2:=r->>'session';
 begin perform public.partner_portal_exchange(jsonb_build_object('action','doc_complete','session',session2,'id',d->>'id','upload_token',d->>'upload_token'));raise exception 'QA cross partner upload';exception when others then if sqlerrm<>'PORTAL_ACCESS_DENIED' then raise;end if;end;
 r:=public.partner_portal_exchange(jsonb_build_object('action','doc_complete','session',session,'id',d->>'id','upload_token',d->>'upload_token'));
 begin perform public.partner_portal_exchange(jsonb_build_object('action','doc_access','session',session2,'id',d->>'id'));raise exception 'QA cross partner read';exception when others then if sqlerrm<>'PORTAL_ACCESS_DENIED' then raise;end if;end;
 if (public.partner_portal_exchange(jsonb_build_object('action','view','session',session2,'partner_id',pid))#>>'{view,public_name}')<>'QA Portal B' then raise exception 'QA untrusted partner id';end if;
 -- Document metadata completion is trusted Edge-only; no actual upload here.
 perform public.admin_partner_portal(jsonb_build_object('action','review_document','id',inv,'document',d->>'id','decision','approved_test','reason','QA sample approved'));
 perform public.admin_partner_portal(jsonb_build_object('action','prepare_message','id',inv));
 begin perform public.admin_partner_portal(jsonb_build_object('action','confirm_simulation','id',inv,'confirmed',false));raise exception 'QA no confirmation';exception when others then if sqlerrm<>'PORTAL_CONFIRM_REQUIRED' then raise;end if;end;
 perform public.admin_partner_portal(jsonb_build_object('action','confirm_simulation','id',inv,'confirmed',true));
 perform public.admin_partner_portal(jsonb_build_object('action','confirm_simulation','id',inv,'confirmed',true));
 if (select count(*) from partner_portal.events where invite_id=inv and kind='initial_message_simulated')<>1 then raise exception 'QA duplicate message';end if;
 perform public.admin_partner_portal(jsonb_build_object('action','queue_reminders','id',inv));
 if exists(select 1 from partner_portal.messages where invite_id=inv and kind<>'initial') then raise exception 'QA early reminder';end if;
 update partner_portal.invites set sent_simulated_at=now()-interval '48 hours' where id=inv;
 perform public.admin_partner_portal(jsonb_build_object('action','queue_reminders','id',inv));perform public.admin_partner_portal(jsonb_build_object('action','queue_reminders','id',inv));
 if (select count(*) from partner_portal.messages where invite_id=inv and kind='d2')<>1 then raise exception 'QA D2 dedupe';end if;
 update partner_portal.invites set sent_simulated_at=now()-interval '120 hours' where id=inv;
 perform public.admin_partner_portal(jsonb_build_object('action','queue_reminders','id',inv));
 if (select state from partner_portal.messages where invite_id=inv and kind='d2')<>'canceled' or not exists(select 1 from partner_portal.messages where invite_id=inv and kind='d5') then raise exception 'QA D5 precedence';end if;
 r:=public.partner_portal_exchange(jsonb_build_object('action','submit','session',session,'data',payload,'version',3));
 perform public.admin_partner_portal(jsonb_build_object('action','review','id',inv,'decision','corrections','version',4,'reason','QA corrigir cadastro'));
 r:=public.partner_portal_exchange(jsonb_build_object('action','submit','session',session,'data',payload,'version',5));
 r:=public.admin_partner_portal(jsonb_build_object('action','review','id',inv,'decision','approved_test','version',6,'reason','QA revisao tecnica'));
 if r->>'partner_activated'<>'false' or r->>'payment_enabled'<>'false' then raise exception 'QA activation';end if;
 if exists(select 1 from partner_portal.messages where invite_id=inv and state='pending') then raise exception 'QA completed reminders';end if;
 begin perform public.partner_portal_exchange(jsonb_build_object('action','doc_prepare','session',session,'sha256','1fd6daf3d23b0bc130e484733d9659da3299dd684cfad2b80cd95d8b4e5df757','size',68,'mime','image/png'));raise exception 'QA completed portal accepted new document';
 exception when others then if sqlerrm<>'PORTAL_READONLY' then raise;end if;end;
 select md5(row_to_json(p)::text) into after_p1 from public.partners p where id=pid;
 if before_p1<>after_p1 or public.partner_fiscal_ready(pid) then raise exception 'QA P1/P3 invariant';end if;
 -- Reissue revokes all old capabilities, including completed session.
 issued:=public.admin_partner_portal(jsonb_build_object('action','issue','partner_id',pid,'email','qa@example.invalid'));
 begin perform public.partner_portal_exchange(jsonb_build_object('action','view','session',session));raise exception 'QA reissue old session';exception when insufficient_privilege then null;end;
 -- Explicit expiration/revocation, invalid-token anti-enumeration and immutable audit.
 r:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',repeat('x',43),'ip_hash',repeat('e',64)));
 if r->>'ok'<>'true' or r ? 'code' then raise exception 'QA token enumeration';end if;
 update partner_portal.sessions set expires_at=now()-interval '1 second' where token_hash=partner_portal.hash(session2);
 begin perform public.partner_portal_exchange(jsonb_build_object('action','view','session',session2));raise exception 'QA expired session';exception when insufficient_privilege then null;end;
 update partner_portal.sessions set expires_at=now()+interval '1 hour' where token_hash=partner_portal.hash(session2);
 update partner_portal.invites set expires_at=now()-interval '1 second' where id=(issued2->>'id')::uuid;
 begin perform public.partner_portal_exchange(jsonb_build_object('action','view','session',session2));raise exception 'QA expired invite';exception when insufficient_privilege then null;end;
 update partner_portal.invites set expires_at=now()+interval '7 days' where id=(issued2->>'id')::uuid;
 begin update partner_portal.events set kind='tampered' where invite_id=inv;raise exception 'QA mutable event';exception when others then if sqlerrm<>'PORTAL_APPEND_ONLY' then raise;end if;end;
 perform public.admin_partner_portal(jsonb_build_object('action','revoke','id',issued->>'id'));
 r:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',split_part(issued->>'link','#invite=',2),'ip_hash',repeat('e',64)));
 if exists(select 1 from partner_portal.challenges where id=(r->>'challenge')::uuid) then raise exception 'QA revoked challenge';end if;
 -- Excess attempts commit within the caller transaction (no raise that resets counters).
 update partner_portal.challenges set created_at=now()-interval '61 seconds' where invite_id=(issued2->>'id')::uuid;
 challenge:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',token2,'ip_hash',repeat('c',64)));
 update partner_portal.challenges set expires_at=now()-interval '1 second' where id=(challenge->>'challenge')::uuid;
 r:=public.partner_portal_exchange(jsonb_build_object('action','verify','invite',token2,'challenge',challenge->>'challenge','code','654321','ip_hash',repeat('c',64)));
 if r->>'ok'<>'false' then raise exception 'QA expired OTP';end if;
 update partner_portal.challenges set expires_at=now()+interval '5 minutes' where id=(challenge->>'challenge')::uuid;
 update partner_portal.challenges set code_hash=extensions.crypt('654321',extensions.gen_salt('bf',8)) where id=(challenge->>'challenge')::uuid;
 for n in 1..5 loop r:=public.partner_portal_exchange(jsonb_build_object('action','verify','invite',token2,'challenge',challenge->>'challenge','code','000000','ip_hash',repeat('c',64)));if r->>'ok'<>'false' then raise exception 'QA wrong OTP';end if;end loop;
 r:=public.partner_portal_exchange(jsonb_build_object('action','verify','invite',token2,'challenge',challenge->>'challenge','code','654321','ip_hash',repeat('c',64)));
 if r->>'ok'<>'false' or (select attempts from partner_portal.challenges where id=(challenge->>'challenge')::uuid)<>5 then raise exception 'QA max attempts';end if;
 for n in 1..20 loop perform partner_portal.rate(repeat('d',64));end loop;
 if partner_portal.rate(repeat('d',64)) then raise exception 'QA IP rate';end if;
 perform public.partner_portal_exchange(jsonb_build_object('action','opt_out','session',session2));
 if (public.partner_portal_exchange(jsonb_build_object('action','view','session',session2))->>'ok')<>'true' then raise exception 'QA optout must preserve portal access';end if;
 -- RLS + grants every table; no JWT partner => Admin RPC denied.
 if has_function_privilege('anon','public.partner_portal_exchange(jsonb)','execute') or has_function_privilege('authenticated','public.partner_portal_exchange(jsonb)','execute') then raise exception 'QA exchange grant';end if;
 if exists(select 1 from pg_class t join pg_namespace s on s.oid=t.relnamespace where s.nspname='partner_portal' and t.relkind='r' and not t.relrowsecurity) then raise exception 'QA RLS';end if;
 if has_schema_privilege('anon','partner_portal','usage') or has_schema_privilege('authenticated','partner_portal','usage') then raise exception 'QA private schema';end if;

 -- Canonical synthetic source/report joins, no provider call or actual payment.
 insert into auth.users(id,email) values(client_id,'report-qa-'||client_id||'@example.invalid');
 select id into subscription_id from public.subscriptions where user_id=client_id;
 insert into public.partner_commission_rules(partner_id,version,commission_percent) values(pid,1,10) returning id into rule_id;
 insert into public.partner_referral_intents(id,partner_id,token_hash,source,created_at,expires_at,consumed_at)
 values(intent_id,pid,partner_portal.hash(intent_id::text),'link',now()-interval '40 days',now()-interval '10 days',now()-interval '39 days');
 insert into public.partner_attributions(user_id,partner_id,rule_id,rule_version,commission_percent,intent_id,source,locked_at)
 values(client_id,pid,rule_id,1,10,intent_id,'link',now()-interval '39 days') returning id into attr_id;
 perform public.partner_ingest_payment(subscription_id,jsonb_build_object('id','report-qa-'||client_id,'invoice_id','qa-invoice-'||client_id,'plan','monthly','currency','BRL','gross_cents',1000,'refunded_cents',0,'paid_at','2026-10-10T12:00:00Z','updated_at',now(),'state','approved','live_mode',false,'history_complete',true,'first_payment_id','report-qa-'||client_id));
 select id into strict commission_id from public.partner_commissions where attribution_id=attr_id;
 r:=public.admin_partner_accountant_report(pid,'2026-10');
 if jsonb_array_length(r->'commissions')<>1 or r#>>'{commissions,0,gross_cents}'<>'1000' or r#>>'{commissions,0,source_date}' is null then raise exception 'QA source report join';end if;
 if jsonb_array_length(public.admin_partner_accountant_report(pid,'2026-09')->'commissions')<>0 then raise exception 'QA report source month filter';end if;
 update public.partner_financial_payments set history_complete=false where attribution_id=attr_id;
 if public.admin_partner_accountant_report(pid,'2026-10')#>>'{commissions,0,gross_cents}' is not null then raise exception 'QA unproven gross leak';end if;
 r:=public.admin_partner_accountant_report(pid,'2026-10');
 if r->>'month_basis'<>'SOURCE_EVENT_NOT_FISCAL_COMPETENCE' or r->'fiscal_competence'<>'null'::jsonb or jsonb_array_length(r->'partners')<>1 then raise exception 'QA report basis';end if;
 if r ? 'recipient_snapshot' or r ? 'user_id' then raise exception 'QA report privacy';end if;
 begin perform public.admin_partner_accountant_report(pid,'2026-13');raise exception 'QA invalid month';exception when others then if sqlerrm<>'ACCOUNTANT_REPORT_MONTH_INVALID' then raise;end if;end;
 perform set_config('request.jwt.claims',(claims||'{"aal":"aal1"}')::text,true);
 begin perform public.admin_partner_portal('{"action":"list"}');raise exception 'QA AAL1 admin';exception when insufficient_privilege then null;end;
 select user_id into admin_id from public.admin_memberships where access_level='admin' and active limit 1;
 if admin_id is not null then
 perform set_config('request.jwt.claim.sub',admin_id::text,true);perform set_config('request.jwt.claims',(claims||jsonb_build_object('sub',admin_id))::text,true);
 begin perform public.admin_partner_portal('{"action":"list"}');raise exception 'QA ADMIN portal access';exception when insufficient_privilege then null;end;
 begin perform public.admin_partner_accountant_report(null,null);raise exception 'QA ADMIN report access';exception when insufficient_privilege then null;end;
 end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 begin perform public.admin_partner_portal('{"action":"list"}');raise exception 'QA partner admin';exception when insufficient_privilege then null;end;
end $qa$;

rollback;
select 'PASS final TEST portal and report rollback' as result;
