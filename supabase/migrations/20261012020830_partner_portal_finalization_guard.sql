begin;
do $$begin perform partner_portal.assert_test();end$$;
create or replace function public.partner_portal_exchange(p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if op not in ('view','logout','opt_out','doc_access') and exists(select 1 from partner_portal.invites where id=iid and completed_at is not null) then raise exception 'PORTAL_READONLY';end if;
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

commit;
