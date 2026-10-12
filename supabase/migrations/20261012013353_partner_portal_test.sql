-- TEST-only partner onboarding. Additive private schema; NEVER modifies P1/P2/P3.
begin;
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'PORTAL_TEST_ONLY';end if;
end $$;
create schema partner_portal;
revoke all on schema partner_portal from public,anon,authenticated,service_role;
create table partner_portal.invites(
 id uuid primary key default gen_random_uuid(),partner_id uuid not null references public.partners(id),
 token_hash text unique not null check(length(token_hash)=64),contact_email text not null check(contact_email~'^[a-zA-Z0-9._+-]+@example\.invalid$'),
 expires_at timestamptz not null,revoked_at timestamptz,completed_at timestamptz,
 opt_in boolean not null default false,contact_confirmed boolean not null default false,opted_out boolean not null default false,
 sent_simulated_at timestamptz,created_by uuid references auth.users(id),created_at timestamptz not null default now());
create index on partner_portal.invites(partner_id);create index on partner_portal.invites(created_by);
create table partner_portal.challenges(
 id uuid primary key default gen_random_uuid(),invite_id uuid not null references partner_portal.invites(id),
 code_hash text not null,expires_at timestamptz not null,attempts integer not null default 0 check(attempts between 0 and 5),
 consumed_at timestamptz,created_at timestamptz not null default now());
create index on partner_portal.challenges(invite_id,created_at);
create table partner_portal.sessions(
 id uuid primary key default gen_random_uuid(),invite_id uuid not null references partner_portal.invites(id),
 token_hash text unique not null,expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default now());
create index on partner_portal.sessions(invite_id);
create table partner_portal.submissions(
 invite_id uuid primary key references partner_portal.invites(id),version integer not null default 0,
 data jsonb not null default '{}'::jsonb,state text not null default 'draft' check(state in ('draft','submitted','corrections','approved_test')),
 correction text,contract_seen_at timestamptz,updated_at timestamptz not null default now());
create table partner_portal.contracts(
 version text primary key,body text not null,sha256 text not null,legal_approved boolean not null default false check(legal_approved=false));
insert into partner_portal.contracts(version,body,sha256) values('qa-draft-1','MINUTA TECNICA SINTETICA — SEM VALIDADE CONTRATUAL. Parecer juridico pendente. Nenhuma ativacao ou pagamento autorizado.',
 encode(extensions.digest(convert_to('MINUTA TECNICA SINTETICA — SEM VALIDADE CONTRATUAL. Parecer juridico pendente. Nenhuma ativacao ou pagamento autorizado.','UTF8'),'sha256'),'hex'));
create table partner_portal.events(
 id bigint generated always as identity primary key,invite_id uuid not null references partner_portal.invites(id),
 actor uuid references auth.users(id),kind text not null,version integer,created_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb);
create index on partner_portal.events(invite_id,created_at);create index on partner_portal.events(actor);
create table partner_portal.messages(
 invite_id uuid not null references partner_portal.invites(id),kind text not null check(kind in ('initial','d2','d5')),
 state text not null check(state in ('pending','simulated','canceled')),created_at timestamptz not null default now(),primary key(invite_id,kind));
create table partner_portal.rates(key text primary key,window_start timestamptz not null default now(),count integer not null default 0);
create table partner_portal.documents(
 id uuid primary key default gen_random_uuid(),invite_id uuid not null references partner_portal.invites(id),
 sha256 text not null,size_bytes integer not null check(size_bytes between 1 and 5242880),mime_type text not null check(mime_type='image/png'),
 state text not null default 'pending' check(state in ('pending','stored','corrections','approved_test')),path text unique not null,
 upload_hash text,upload_expires timestamptz,created_at timestamptz not null default now(),reason text);
create index on partner_portal.documents(invite_id);
do $$ declare t text; begin
 foreach t in array array['invites','challenges','sessions','submissions','contracts','events','messages','rates','documents'] loop
 execute format('alter table partner_portal.%I enable row level security',t);
 execute format('revoke all on partner_portal.%I from public,anon,authenticated,service_role',t);
 end loop;end $$;
revoke all on all sequences in schema partner_portal from public,anon,authenticated,service_role;
create function partner_portal.immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'PORTAL_APPEND_ONLY';end$$;
create trigger portal_event_immutable before update or delete on partner_portal.events for each row execute function partner_portal.immutable();
create trigger portal_contract_immutable before update or delete on partner_portal.contracts for each row execute function partner_portal.immutable();
create function partner_portal.assert_test() returns void language plpgsql set search_path='' as $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'PORTAL_TEST_ONLY';end if;
end$$;
create function partner_portal.hash(t text) returns text language sql immutable set search_path='' as $$select encode(extensions.digest(convert_to(t,'UTF8'),'sha256'),'hex')$$;
create function partner_portal.token() returns text language sql volatile set search_path='' as $$select translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_')$$;
create function partner_portal.rate(k text) returns boolean language plpgsql set search_path='' as $$
declare r partner_portal.rates;
begin
 insert into partner_portal.rates(key) values(k) on conflict do nothing;
 select * into r from partner_portal.rates where key=k for update;
 if r.window_start<now()-interval '1 hour' then update partner_portal.rates set window_start=now(),count=1 where key=k;return true;end if;
 if r.count>=20 then return false;end if;
 update partner_portal.rates set count=count+1 where key=k;return true;
end$$;
create function partner_portal.authorize(t text) returns uuid language plpgsql set search_path='' as $$
declare iid uuid;
begin
 perform partner_portal.assert_test();
 select i.id into iid from partner_portal.sessions s join partner_portal.invites i on i.id=s.invite_id
 where s.token_hash=partner_portal.hash(t) and s.expires_at>now() and s.revoked_at is null and i.expires_at>now() and i.revoked_at is null and not i.opted_out;
 if iid is null then raise exception 'PORTAL_ACCESS_DENIED' using errcode='42501';end if;
 -- Serialize session operations against invite revocation/review and optimistic versions.
 perform 1 from partner_portal.invites where id=iid for update;
 if not exists(select 1 from partner_portal.invites where id=iid and expires_at>now() and revoked_at is null and not opted_out) then raise exception 'PORTAL_ACCESS_DENIED' using errcode='42501';end if;
 return iid;
end$$;
create function partner_portal.view(iid uuid) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('mode','synthetic_only','public_name',p.public_name,'expires_at',i.expires_at,
 'submission',to_jsonb(s)-'invite_id','contract',(select to_jsonb(c) from partner_portal.contracts c where version='qa-draft-1'),
 'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'state',d.state,'created_at',d.created_at,'reason',d.reason)) from partner_portal.documents d where d.invite_id=i.id),'[]'::jsonb),
 'can_activate',false,'can_pay',false,'real_collection_enabled',false)
 from partner_portal.invites i join public.partners p on p.id=i.partner_id join partner_portal.submissions s on s.invite_id=i.id where i.id=iid
$$;
-- Public-schema wrappers intentionally service-only; partner tokens are not Auth/Admin JWTs.
create function public.partner_portal_exchange(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text:=p_request->>'action';i partner_portal.invites;c partner_portal.challenges;iid uuid;tid uuid;raw text;code text;v integer;payload jsonb;d partner_portal.documents;
begin
 perform partner_portal.assert_test();
 if length(p_request::text)>16000 then raise exception 'PORTAL_INVALID_REQUEST';end if;
 if op in ('challenge','verify') then
 if coalesce(p_request->>'ip_hash','')!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','PORTAL_ACCESS_DENIED');end if;
 if not partner_portal.rate(p_request->>'ip_hash') then return jsonb_build_object('ok',false,'code','PORTAL_ACCESS_DENIED');end if;
 select * into i from partner_portal.invites where token_hash=partner_portal.hash(coalesce(p_request->>'invite','')) for update;
 if i.id is null or i.expires_at<=now() or i.revoked_at is not null or i.opted_out or i.completed_at is not null then
 if op='challenge' then return jsonb_build_object('ok',true,'challenge',gen_random_uuid(),'mode','synthetic_only');end if;
 return jsonb_build_object('ok',false,'code','PORTAL_ACCESS_DENIED');end if;
 if op='challenge' then
 if exists(select 1 from partner_portal.challenges where invite_id=i.id and created_at>now()-interval '60 seconds')
 or (select count(*) from partner_portal.challenges where invite_id=i.id and created_at>now()-interval '1 hour')>=5 then
 return jsonb_build_object('ok',true,'challenge',gen_random_uuid(),'mode','synthetic_only');end if;
 -- Crypto OTP; never delivered to a provider in synthetic-only mode.
 code:=lpad(((('x'||encode(extensions.gen_random_bytes(3),'hex'))::bit(24)::bigint)%1000000)::text,6,'0');
 update partner_portal.challenges set consumed_at=now() where invite_id=i.id and consumed_at is null;
 insert into partner_portal.challenges(invite_id,code_hash,expires_at) values(i.id,extensions.crypt(code,extensions.gen_salt('bf',8)),least(now()+interval '5 minutes',i.expires_at)) returning id into tid;
 -- No code/PII in events or partner response; only OWNER obtains synthetic OTP.
 insert into partner_portal.events(invite_id,kind,metadata) values(i.id,'challenge_created',jsonb_build_object('challenge',tid));
 return jsonb_build_object('ok',true,'challenge',tid,'mode','synthetic_only');
 end if;
 select * into c from partner_portal.challenges where id=nullif(p_request->>'challenge','')::uuid and invite_id=i.id for update;
 if c.id is null or c.expires_at<=now() or c.consumed_at is not null or c.attempts>=5 then return jsonb_build_object('ok',false,'code','PORTAL_ACCESS_DENIED');end if;
 update partner_portal.challenges set attempts=attempts+1 where id=c.id;
 if coalesce(p_request->>'code','')!~'^[0-9]{6}$' or extensions.crypt(p_request->>'code',c.code_hash)<>c.code_hash then return jsonb_build_object('ok',false,'code','PORTAL_ACCESS_DENIED');end if;
 update partner_portal.challenges set consumed_at=now() where id=c.id;
 raw:=partner_portal.token();
 insert into partner_portal.sessions(invite_id,token_hash,expires_at) values(i.id,partner_portal.hash(raw),least(now()+interval '1 hour',i.expires_at));
 insert into partner_portal.events(invite_id,kind) values(i.id,'otp_verified_synthetic');
 return jsonb_build_object('ok',true,'session',raw,'expires_at',least(now()+interval '1 hour',i.expires_at),'view',partner_portal.view(i.id));
 end if;
 iid:=partner_portal.authorize(coalesce(p_request->>'session',''));
 if op='view' then return jsonb_build_object('ok',true,'view',partner_portal.view(iid));end if;
 if op='logout' then update partner_portal.sessions set revoked_at=now() where token_hash=partner_portal.hash(p_request->>'session');return jsonb_build_object('ok',true);end if;
 if op='opt_out' then
 update partner_portal.invites set opted_out=true,opt_in=false where id=iid;
 update partner_portal.messages set state='canceled' where invite_id=iid and state='pending';
 update partner_portal.sessions set revoked_at=now() where invite_id=iid;
 insert into partner_portal.events(invite_id,kind) values(iid,'opt_out');return jsonb_build_object('ok',true);end if;
 if op='contract_seen' then
 if p_request->>'version'<>'qa-draft-1' or p_request->>'hash'<>(select sha256 from partner_portal.contracts where version='qa-draft-1') then raise exception 'PORTAL_CONTRACT_VERSION';end if;
 update partner_portal.submissions set contract_seen_at=now() where invite_id=iid;
 insert into partner_portal.events(invite_id,kind,metadata) values(iid,'contract_preview',jsonb_build_object('version','qa-draft-1'));
 return jsonb_build_object('ok',true);end if;
 if op='accept_contract' then raise exception 'PORTAL_LEGAL_PENDING';end if;
 if op in ('save','submit') then
 payload:=p_request->'data';v:=(p_request->>'version')::integer;
 if coalesce(jsonb_typeof(payload),'')<>'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('kind','legal_name','document','email','pix_key'))
 or coalesce(payload->>'kind','') not in ('CPF','MEI','CNPJ') or coalesce(payload->>'legal_name','')!~'^QA [A-Za-z0-9 -]{2,60}$'
 or (payload->>'kind'='CPF' and coalesce(payload->>'document','')<>'00000000000')
 or (payload->>'kind' in ('MEI','CNPJ') and coalesce(payload->>'document','')<>'00000000000000')
 or coalesce(payload->>'email','')!~'^[a-zA-Z0-9._+-]+@example\.invalid$'
 or coalesce(payload->>'pix_key','')<>'QA-ONLY-NOT-A-PIX' then raise exception 'PORTAL_SYNTHETIC_ONLY';end if;
 update partner_portal.submissions set data=payload,version=version+1,state=case when op='submit' then 'submitted' else 'draft' end,correction=null,updated_at=now()
 where invite_id=iid and version=v and state in ('draft','corrections');
 if not found then raise exception 'PORTAL_VERSION_CONFLICT';end if;
 insert into partner_portal.events(invite_id,kind,version,metadata) values(iid,op,v+1,jsonb_build_object('kind',payload->>'kind'));
 return jsonb_build_object('ok',true,'view',partner_portal.view(iid));end if;
 if op='doc_prepare' then
 if coalesce(p_request->>'sha256','')<>'1fd6daf3d23b0bc130e484733d9659da3299dd684cfad2b80cd95d8b4e5df757' or coalesce((p_request->>'size')::integer,0)<>68 or coalesce(p_request->>'mime','')<>'image/png'
 or (select count(*) from partner_portal.documents where invite_id=iid)>=5 then raise exception 'PORTAL_SYNTHETIC_ONLY';end if;
 tid:=gen_random_uuid();raw:=partner_portal.token();
 insert into partner_portal.documents(id,invite_id,sha256,size_bytes,mime_type,path,upload_hash,upload_expires)
 values(tid,iid,p_request->>'sha256',68,'image/png',iid||'/'||tid,partner_portal.hash(raw),least(now()+interval '2 minutes',(select expires_at from partner_portal.invites where id=iid)));
 return jsonb_build_object('ok',true,'id',tid,'path',iid||'/'||tid,'upload_token',raw);end if;
 if op='doc_complete' then
 select * into d from partner_portal.documents where id=(p_request->>'id')::uuid and invite_id=iid for update;
 if d.id is null or d.state<>'pending' or d.upload_expires<=now() or d.upload_hash<>partner_portal.hash(coalesce(p_request->>'upload_token','')) then raise exception 'PORTAL_ACCESS_DENIED';end if;
 update partner_portal.documents set state='stored',upload_hash=null where id=d.id;
 insert into partner_portal.events(invite_id,kind,metadata) values(iid,'synthetic_document_stored',jsonb_build_object('document',d.id));return jsonb_build_object('ok',true);end if;
 if op='doc_access' then
 select * into d from partner_portal.documents where id=(p_request->>'id')::uuid and invite_id=iid and state<>'pending';
 if d.id is null then raise exception 'PORTAL_ACCESS_DENIED';end if;
 return jsonb_build_object('ok',true,'path',d.path,'sha256',d.sha256,'mime',d.mime_type);end if;
 raise exception 'PORTAL_INVALID_REQUEST';
end$$;
-- OWNER/AAL2 current session; no new Admin Auth or membership permissions.
create function public.admin_partner_portal(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text:=p_request->>'action';i partner_portal.invites;pid uuid;raw text;tid uuid;code text;payload jsonb;v integer;
begin
 perform partner_portal.assert_test();perform public.partner_admin_assert(op<>'list',true);
 if op='list' then return jsonb_build_object('mode','synthetic_only','invites',coalesce((select jsonb_agg(jsonb_build_object(
 'id',iv.id,'partner_id',iv.partner_id,'public_name',p.public_name,'expires_at',iv.expires_at,'revoked_at',iv.revoked_at,'completed_at',iv.completed_at,
 'opt_in',iv.opt_in,'contact_confirmed',iv.contact_confirmed,'opted_out',iv.opted_out,'sent_at',iv.sent_simulated_at,
 'submission',to_jsonb(s)-'invite_id','messages',coalesce((select jsonb_agg(to_jsonb(m)-'invite_id') from partner_portal.messages m where m.invite_id=iv.id),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(to_jsonb(d)-'upload_hash'-'upload_expires'-'path'-'invite_id') from partner_portal.documents d where d.invite_id=iv.id),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(e)-'invite_id'-'actor') from partner_portal.events e where e.invite_id=iv.id),'[]'::jsonb)))
 from partner_portal.invites iv join public.partners p on p.id=iv.partner_id join partner_portal.submissions s on s.invite_id=iv.id),'[]'::jsonb));end if;
 if op='issue' then
 pid:=(p_request->>'partner_id')::uuid;perform 1 from public.partners where id=pid and status='draft' and public_name like 'QA %' for update;
 if not found or coalesce(p_request->>'email','')!~'^[a-zA-Z0-9._+-]+@example\.invalid$' then raise exception 'PORTAL_SYNTHETIC_ONLY';end if;
 update partner_portal.invites set revoked_at=now() where partner_id=pid and revoked_at is null;
 update partner_portal.messages m set state='canceled' from partner_portal.invites iv where m.invite_id=iv.id and iv.partner_id=pid and m.state='pending';
 raw:=partner_portal.token();
 insert into partner_portal.invites(partner_id,token_hash,contact_email,expires_at,created_by,opt_in,contact_confirmed)
 values(pid,partner_portal.hash(raw),p_request->>'email',now()+interval '7 days',auth.uid(),coalesce((p_request->>'opt_in')::boolean,false),coalesce((p_request->>'contact_confirmed')::boolean,false)) returning id into tid;
 insert into partner_portal.submissions(invite_id) values(tid);
 insert into partner_portal.events(invite_id,actor,kind) values(tid,auth.uid(),'issued_synthetic');
 return jsonb_build_object('id',tid,'link','https://homologacao.pepday.com.br/parceiros/convite/#invite='||raw,'expires_at',now()+interval '7 days','mode','synthetic_only');
 end if;
 select * into i from partner_portal.invites where id=(p_request->>'id')::uuid for update;
 if i.id is null then raise exception 'PORTAL_ACCESS_DENIED';end if;
 if op='revoke' then
 update partner_portal.invites set revoked_at=now() where id=i.id;
 update partner_portal.sessions set revoked_at=now() where invite_id=i.id;
 update partner_portal.messages set state='canceled' where invite_id=i.id and state='pending';
 insert into partner_portal.events(invite_id,actor,kind) values(i.id,auth.uid(),'revoked');return jsonb_build_object('ok',true);end if;
 if op='cancel_messages' then
 update partner_portal.invites set opted_out=true,opt_in=false where id=i.id;
 update partner_portal.messages set state='canceled' where invite_id=i.id and state='pending';
 insert into partner_portal.events(invite_id,actor,kind) values(i.id,auth.uid(),'messages_canceled');return jsonb_build_object('ok',true);end if;
 if i.revoked_at is not null or i.expires_at<=now() or i.opted_out or i.completed_at is not null then raise exception 'PORTAL_ACCESS_DENIED';end if;
 if op='qa_code' then
 -- Reset existing unconsumed challenge to a NEW crypto OTP, returned only to OWNER.
 -- No public endpoint returns any code and no provider/email/phone is called.
 tid:=(p_request->>'challenge')::uuid;
 code:=lpad(((('x'||encode(extensions.gen_random_bytes(3),'hex'))::bit(24)::bigint)%1000000)::text,6,'0');
 update partner_portal.challenges set code_hash=extensions.crypt(code,extensions.gen_salt('bf',8))
 where id=tid and invite_id=i.id and expires_at>now() and consumed_at is null and attempts=0;
 if not found then raise exception 'PORTAL_ACCESS_DENIED';end if;
 return jsonb_build_object('code',code,'mode','synthetic_only');end if;
 if op in ('prepare_message','confirm_simulation','queue_reminders') then
 if not i.opt_in or not i.contact_confirmed or not exists(select 1 from public.partners where id=i.partner_id and status='draft') then raise exception 'PORTAL_CONTACT_REQUIRED';end if;
 if op='prepare_message' then
 insert into partner_portal.messages(invite_id,kind,state) values(i.id,'initial','pending') on conflict do nothing;
 return jsonb_build_object('ok',true,'delivery','disabled');end if;
 if op='confirm_simulation' then
 if coalesce((p_request->>'confirmed')::boolean,false)<>true then raise exception 'PORTAL_CONFIRM_REQUIRED';end if;
 update partner_portal.messages set state='simulated' where invite_id=i.id and kind='initial' and state='pending';
 if found then update partner_portal.invites set sent_simulated_at=now() where id=i.id;
 insert into partner_portal.events(invite_id,actor,kind) values(i.id,auth.uid(),'initial_message_simulated');end if;
 return jsonb_build_object('ok',true,'delivery','disabled');end if;
 if i.sent_simulated_at is null then raise exception 'PORTAL_NOT_SENT';end if;
 if i.sent_simulated_at<=now()-interval '120 hours' then
 insert into partner_portal.messages(invite_id,kind,state) values(i.id,'d5','pending') on conflict do nothing;
 update partner_portal.messages set state='canceled' where invite_id=i.id and kind='d2' and state='pending';
 elsif i.sent_simulated_at<=now()-interval '48 hours' and not exists(select 1 from partner_portal.messages where invite_id=i.id and kind='d5') then
 insert into partner_portal.messages(invite_id,kind,state) values(i.id,'d2','pending') on conflict do nothing;end if;
 return jsonb_build_object('ok',true,'delivery','disabled');
 end if;
 if op='review' then
 if p_request->>'decision' not in ('corrections','approved_test') or coalesce(p_request->>'reason','')!~'^QA [A-Za-z0-9 -]{2,120}$' then raise exception 'PORTAL_INVALID_REVIEW';end if;
 v:=(p_request->>'version')::integer;
 update partner_portal.submissions set state=p_request->>'decision',correction=p_request->>'reason',version=version+1,updated_at=now() where invite_id=i.id and state='submitted' and version=v;
 if not found then raise exception 'PORTAL_VERSION_CONFLICT';end if;
 if p_request->>'decision'='approved_test' then update partner_portal.invites set completed_at=now() where id=i.id;update partner_portal.messages set state='canceled' where invite_id=i.id and state='pending';end if;
 insert into partner_portal.events(invite_id,actor,kind,version) values(i.id,auth.uid(),p_request->>'decision',v+1);
 return jsonb_build_object('ok',true,'partner_activated',false,'payment_enabled',false);end if;
 if op='review_document' then
 if p_request->>'decision' not in ('corrections','approved_test') or coalesce(p_request->>'reason','')!~'^QA [A-Za-z0-9 -]{2,120}$' then raise exception 'PORTAL_INVALID_REVIEW';end if;
 update partner_portal.documents set state=p_request->>'decision',reason=p_request->>'reason' where id=(p_request->>'document')::uuid and invite_id=i.id and state='stored';
 if not found then raise exception 'PORTAL_ACCESS_DENIED';end if;
 insert into partner_portal.events(invite_id,actor,kind,metadata) values(i.id,auth.uid(),'review_synthetic_document',jsonb_build_object('document',p_request->>'document'));
 return jsonb_build_object('ok',true,'fiscal_approved',false);end if;
 raise exception 'PORTAL_INVALID_REQUEST';
end$$;
revoke all on all functions in schema partner_portal from public,anon,authenticated,service_role;
revoke all on function public.partner_portal_exchange(jsonb) from public,anon,authenticated;
grant execute on function public.partner_portal_exchange(jsonb) to service_role;
revoke all on function public.admin_partner_portal(jsonb) from public,anon,service_role;
grant execute on function public.admin_partner_portal(jsonb) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('partner-portal-synthetic-test','partner-portal-synthetic-test',false,5242880,array['image/png']);
create policy portal_synthetic_server_only on storage.objects as restrictive for all to public
 using(bucket_id<>'partner-portal-synthetic-test') with check(bucket_id<>'partner-portal-synthetic-test');
-- Additive OWNER report projection. No changes to approved finance RPCs or state.
create function public.admin_partner_accountant_report(p_partner uuid default null,p_month text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare start_at timestamptz;end_at timestamptz;
begin
 perform partner_portal.assert_test();perform public.partner_admin_assert(false,true);perform public.partner_finance_assert();
 if p_partner is not null and not exists(select 1 from public.partners where id=p_partner) then raise exception 'ACCOUNTANT_REPORT_PARTNER_INVALID';end if;
 if p_month is not null then
 if p_month !~'^(20[0-9]{2})-(0[1-9]|1[0-2])$' then raise exception 'ACCOUNTANT_REPORT_MONTH_INVALID';end if;
 start_at:=(p_month||'-01 00:00:00')::timestamp at time zone 'America/Sao_Paulo';end_at:=((p_month||'-01')::date+interval '1 month') at time zone 'America/Sao_Paulo';
 end if;
 return jsonb_build_object('can_manage',true,'month_basis','SOURCE_EVENT_NOT_FISCAL_COMPETENCE','fiscal_competence',null,
 'partners',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'public_name',p.public_name)) from public.partners p where p_partner is null or p.id=p_partner),'[]'::jsonb),
 'commissions',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'partner_id',c.partner_id,'state',c.state,'earned_cents',c.earned_cents,'reserved_cents',c.reserved_cents,'paid_cents',c.paid_cents,
 'release_at',c.release_at,'percent',c.percent,'plan',f.plan,'source_date',f.paid_at,'source_reference',f.provider_invoice_id,
 'gross_cents',case when f.currency='BRL' and f.history_complete then f.gross_cents else null end,
 'refunded_cents',case when f.currency='BRL' and f.history_complete then f.refunded_cents else null end,
 'history_complete',f.history_complete,'fiscal_ready',public.partner_fiscal_ready(c.partner_id)))
 from public.partner_commissions c join public.partner_financial_payments f on f.id=c.payment_id
 where (p_partner is null or c.partner_id=p_partner) and (p_month is null or f.paid_at>=start_at and f.paid_at<end_at)),'[]'::jsonb),
 'payouts',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'partner_id',b.partner_id,'state',b.state,'total_cents',b.total_cents,'created_at',b.created_at,'paid_at',b.paid_at,
 'fiscal_state',b.fiscal_state,'withheld_cents',case when b.fiscal_state='approved' then b.withheld_cents else null end,'net_cents',case when b.fiscal_state='approved' then b.net_cents else null end,
 'proof_document_id',b.proof_document_id))
 from public.partner_payouts b where (p_partner is null or b.partner_id=p_partner) and b.state='paid' and (p_month is null or b.paid_at>=start_at and b.paid_at<end_at)),'[]'::jsonb),
 'adjustments',coalesce((select jsonb_agg(jsonb_build_object('commission_id',l.commission_id,'partner_id',c.partner_id,'kind',l.kind,'amount_cents',l.amount_cents,'created_at',l.created_at))
 from public.partner_ledger_entries l join public.partner_commissions c on c.id=l.commission_id
 where l.kind in ('adjusted','review','resolved','debt_settled') and (p_partner is null or c.partner_id=p_partner) and (p_month is null or l.created_at>=start_at and l.created_at<end_at)),'[]'::jsonb));
end$$;
revoke all on function public.admin_partner_accountant_report(uuid,text) from public,anon,service_role;
grant execute on function public.admin_partner_accountant_report(uuid,text) to authenticated;

commit;
