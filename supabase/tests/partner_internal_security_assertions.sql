begin;
do $qa$
declare owner_id uuid;sid uuid:=gen_random_uuid();pid uuid:=gen_random_uuid();claims jsonb;issued jsonb;inv uuid;token text;r jsonb;challenge jsonb;code jsonb;sess text;n integer;
begin
select user_id into strict owner_id from public.admin_memberships where access_level='owner' and active;
insert into auth.sessions(id,user_id,created_at) values(sid,owner_id,now());
claims:=jsonb_build_object('sub',owner_id,'iss','https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1','aal','aal2','session_id',sid,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint),jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)));
perform set_config('request.jwt.claim.sub',owner_id::text,true);perform set_config('request.jwt.claims',claims::text,true);
insert into public.partners(id,public_name,partner_type,slug,public_code,status) values(pid,'QA Security','loja','qa-sec-'||pid,upper(left(replace(pid::text,'-',''),8)),'draft');
issued:=public.admin_partner_portal(jsonb_build_object('action','issue','partner_id',pid,'email','sec@example.invalid','opt_in',true,'contact_confirmed',true));
inv:=(issued->>'id')::uuid;token:=split_part(issued->>'link','#invite=',2);
challenge:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',token,'ip_hash',repeat('a',64)));
code:=public.admin_partner_portal(jsonb_build_object('action','qa_code','id',inv,'challenge',challenge->>'challenge'));
r:=public.partner_portal_exchange(jsonb_build_object('action','verify','invite',token,'challenge',challenge->>'challenge','code',code->>'code','ip_hash',repeat('b',64)));sess:=r->>'session';
if sess is null then raise exception 'QA session';end if;
perform public.admin_partner_portal(jsonb_build_object('action','prepare_message','id',inv));
perform public.partner_portal_exchange(jsonb_build_object('action','opt_out','session',sess));
if (public.partner_portal_exchange(jsonb_build_object('action','view','session',sess))->>'ok')<>'true' then raise exception 'QA channel optout revokes account';end if;
if exists(select 1 from partner_portal.messages where invite_id=inv and state='pending') then raise exception 'QA optout did not cancel messages';end if;
begin perform public.admin_partner_portal(jsonb_build_object('action','prepare_message','id',inv));raise exception 'QA optout send accepted';exception when others then if sqlerrm<>'PORTAL_CONTACT_REQUIRED' then raise;end if;end;
perform public.admin_partner_portal(jsonb_build_object('action','revoke','id',inv));
begin perform public.partner_portal_exchange(jsonb_build_object('action','view','session',sess));raise exception 'QA revoked portal';exception when insufficient_privilege then null;end;
-- A forged IP hash cannot create a new token-bound quota.
for n in 1..18 loop
r:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',token,'ip_hash',partner_portal.hash(n::text)));
end loop;
r:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',token,'ip_hash',repeat('c',64)));
if r->>'ok'<>'false' then raise exception 'QA token-bound budget bypass';end if;
if has_function_privilege('anon','partner_portal.request_budget(text)','execute') or has_function_privilege('authenticated','partner_portal.request_budget(text)','execute') then raise exception 'QA budget public';end if;
-- Capacity is technical, never fiscal. Shared gate also bounds random-token spraying.
update partner_portal.rates set count=200,window_start=now() where key='global:portal-test-v1';
r:=public.partner_portal_exchange(jsonb_build_object('action','challenge','invite',repeat('Z',43),'ip_hash',repeat('d',64)));
if r->>'ok'<>'false' then raise exception 'QA shared budget bypass';end if;
end$qa$;
rollback;
select 'PASS_INTERNAL_SECURITY_ROLLBACK' result;
