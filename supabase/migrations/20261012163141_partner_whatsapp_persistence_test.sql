-- TEST synthetic-only persistence. No phone, message body, token, OTP or provider credentials.
begin;
select partner_portal.assert_test();
create schema partner_whatsapp;
revoke all on schema partner_whatsapp from public,anon,authenticated,service_role;
create table partner_whatsapp.config(
 singleton boolean primary key default true check(singleton),mode text not null default 'disabled' check(mode in ('disabled','test_synthetic')),
 real_send boolean not null default false check(not real_send),real_collection boolean not null default false check(not real_collection),
 central_enabled boolean not null default false check(not central_enabled));
insert into partner_whatsapp.config default values;
create table partner_whatsapp.contacts(
 label text primary key check(label~'^QA-CONTACT-[A-Z0-9_-]{1,40}$'),
 partner_id uuid not null references public.partners(id),suppressed boolean not null default false,
 consent_version text not null check(consent_version='qa-contact-v1'),created_at timestamptz not null default now());
create index on partner_whatsapp.contacts(partner_id);
create table partner_whatsapp.bindings(
 invite_id uuid primary key references partner_portal.invites(id),label text not null references partner_whatsapp.contacts(label));
create index on partner_whatsapp.bindings(label);
create table partner_whatsapp.outbox(
 id uuid primary key default gen_random_uuid(),invite_id uuid not null,kind text not null,
 state text not null default 'queued' check(state in ('queued','simulated','sent','delivered','read','failed','canceled')),
 delivery_hash text unique,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(invite_id,kind),foreign key(invite_id,kind) references partner_portal.messages(invite_id,kind));
create index on partner_whatsapp.outbox(invite_id);
create table partner_whatsapp.receipts(
 event_hash text primary key check(event_hash~'^[a-f0-9]{64}$'),
 fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 kind text not null check(kind in ('opt_out','drop','status')),
 created_at timestamptz not null default now());
create table partner_whatsapp.audit(
 id bigint generated always as identity primary key,kind text not null check(kind in ('mode','bind','queue','simulate','cancel','opt_out','status')),
 invite_id uuid references partner_portal.invites(id),created_at timestamptz not null default now());
create index on partner_whatsapp.audit(invite_id);
create trigger whatsapp_receipt_immutable before update or delete on partner_whatsapp.receipts for each row execute function partner_portal.immutable();
create trigger whatsapp_audit_immutable before update or delete on partner_whatsapp.audit for each row execute function partner_portal.immutable();
do $$declare t text;begin
 foreach t in array array['config','contacts','bindings','outbox','receipts','audit'] loop
 execute format('alter table partner_whatsapp.%I enable row level security',t);
 execute format('revoke all on partner_whatsapp.%I from public,anon,authenticated,service_role',t);
 end loop;
end$$;
revoke all on all sequences in schema partner_whatsapp from public,anon,authenticated,service_role;
-- Shared invite lock: cancellation, revocation and completion win over later simulation.
create function partner_whatsapp.cancel_on_invite() returns trigger language plpgsql set search_path='' as $$
begin
 if new.opted_out or new.revoked_at is not null or new.completed_at is not null then
 update partner_whatsapp.outbox set state='canceled',updated_at=now() where invite_id=new.id and state='queued';
 end if;
 return new;
end$$;
create trigger whatsapp_invite_cancel after update on partner_portal.invites for each row execute function partner_whatsapp.cancel_on_invite();

create function public.admin_partner_whatsapp_test(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare op text:=p_request->>'action';i partner_portal.invites;v_label text:=p_request->>'label';o partner_whatsapp.outbox;ref text;n integer;
begin
 perform partner_portal.assert_test();perform public.partner_admin_assert(op<>'list',true);
 if jsonb_typeof(p_request)<>'object' or length(p_request::text)>2000 then raise exception 'WHATSAPP_REQUEST_DENIED';end if;
 if op='list' then return jsonb_build_object('mode',(select mode from partner_whatsapp.config),'real_send',false,'central_enabled',false,
 'outbox',coalesce((select jsonb_agg(to_jsonb(x)-'delivery_hash') from partner_whatsapp.outbox x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(x)) from (select kind,invite_id,created_at from partner_whatsapp.audit order by id desc limit 100) x),'[]'::jsonb));end if;
 if op='mode' then
 if coalesce(p_request->>'mode','') not in ('disabled','test_synthetic') then raise exception 'WHATSAPP_REAL_DISABLED';end if;
 update partner_whatsapp.config set mode=p_request->>'mode';
 insert into partner_whatsapp.audit(kind) values('mode');return jsonb_build_object('ok',true,'real_send',false);end if;
 select * into i from partner_portal.invites where id=(p_request->>'invite_id')::uuid for update;
 if i.id is null then raise exception 'WHATSAPP_INVITE_DENIED';end if;
 if op='cancel' then
 update partner_whatsapp.outbox set state='canceled',updated_at=now() where invite_id=i.id and state='queued';
 insert into partner_whatsapp.audit(kind,invite_id) values('cancel',i.id);return jsonb_build_object('ok',true);end if;
 if i.revoked_at is not null or i.completed_at is not null or i.expires_at<=now() or i.opted_out or not i.opt_in or not i.contact_confirmed
 or not exists(select 1 from public.partners where id=i.partner_id and status='draft' and public_name like 'QA %') then raise exception 'WHATSAPP_CONTACT_DENIED';end if;
 if op='bind' then
 if coalesce(v_label,'')!~'^QA-CONTACT-[A-Z0-9_-]{1,40}$' or p_request->>'consent_version' is distinct from 'qa-contact-v1' then raise exception 'WHATSAPP_SYNTHETIC_ONLY';end if;
 insert into partner_whatsapp.contacts(label,partner_id,consent_version) values(v_label,i.partner_id,'qa-contact-v1') on conflict do nothing;
 perform 1 from partner_whatsapp.contacts c where c.label=v_label and c.partner_id=i.partner_id and not c.suppressed for update;
 if not found then raise exception 'WHATSAPP_CONTACT_DENIED';end if;
 insert into partner_whatsapp.bindings(invite_id,label) values(i.id,v_label) on conflict do nothing;
 if not exists(select 1 from partner_whatsapp.bindings b where b.invite_id=i.id and b.label=v_label) then raise exception 'WHATSAPP_BIND_IMMUTABLE';end if;
 insert into partner_whatsapp.audit(kind,invite_id) values('bind',i.id);return jsonb_build_object('ok',true);end if;
 if not exists(select 1 from partner_whatsapp.bindings b join partner_whatsapp.contacts c on c.label=b.label where b.invite_id=i.id and not c.suppressed) then raise exception 'WHATSAPP_CONTACT_DENIED';end if;
 if op='sync_queue' then
 insert into partner_whatsapp.outbox(invite_id,kind) select m.invite_id,m.kind from partner_portal.messages m where m.invite_id=i.id and m.state='pending' on conflict do nothing;
 get diagnostics n=row_count;insert into partner_whatsapp.audit(kind,invite_id) values('queue',i.id);return jsonb_build_object('ok',true,'added',n);end if;
 if op='simulate' then
 if (select mode from partner_whatsapp.config)<>'test_synthetic' or coalesce((p_request->>'confirmed')::boolean,false)<>true then raise exception 'WHATSAPP_SIMULATION_DENIED';end if;
 select * into o from partner_whatsapp.outbox where invite_id=i.id and id=(p_request->>'id')::uuid for update;
 if o.id is null or o.state<>'queued' or not exists(select 1 from partner_portal.messages m where m.invite_id=i.id and m.kind=o.kind and m.state='pending') then raise exception 'WHATSAPP_REPLAY_DENIED';end if;
 ref:='qa.delivery.'||o.id;
 update partner_whatsapp.outbox set state='simulated',delivery_hash=partner_portal.hash(ref),updated_at=now() where id=o.id;
 insert into partner_whatsapp.audit(kind,invite_id) values('simulate',i.id);
 return jsonb_build_object('ok',true,'simulation',true,'delivery_ref',ref,'real_send',false);end if;
 raise exception 'WHATSAPP_REQUEST_DENIED';
end$$;
revoke all on function public.admin_partner_whatsapp_test(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_partner_whatsapp_test(jsonb) to authenticated;

-- One transaction couples dedupe and side effects. Never acknowledge an event before its effects commit.
create function public.partner_whatsapp_ingest_test(p_events jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb;fingerprint text;n integer;accepted integer:=0;duplicates integer:=0;iid uuid;v_label text;v_state text;o partner_whatsapp.outbox;
begin
 perform partner_portal.assert_test();
 if (select mode from partner_whatsapp.config)<>'test_synthetic' then raise exception 'WHATSAPP_DISABLED';end if;
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>100 or length(p_events::text)>32000 then raise exception 'WHATSAPP_EVENTS_DENIED';end if;
 for e in select value from jsonb_array_elements(p_events) loop
 if jsonb_typeof(e)<>'object' or exists(select 1 from jsonb_object_keys(e) k where k not in ('event_hash','kind','contact_label','delivery_hash','state'))
 or coalesce(e->>'event_hash','')!~'^[a-f0-9]{64}$' or coalesce(e->>'kind','') not in ('drop','opt_out','status') then raise exception 'WHATSAPP_EVENTS_DENIED';end if;
 if e->>'kind'='opt_out' and coalesce(e->>'contact_label','')!~'^QA-CONTACT-[A-Z0-9_-]{1,40}$' then raise exception 'WHATSAPP_EVENTS_DENIED';end if;
 if e->>'kind'='status' and (coalesce(e->>'delivery_hash','')!~'^[a-f0-9]{64}$' or coalesce(e->>'state','') not in ('sent','delivered','read','failed')) then raise exception 'WHATSAPP_EVENTS_DENIED';end if;
 fingerprint:=partner_portal.hash(e::text);
 insert into partner_whatsapp.receipts(event_hash,fingerprint,kind) values(e->>'event_hash',fingerprint,e->>'kind') on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then
 if (select r.fingerprint from partner_whatsapp.receipts r where r.event_hash=e->>'event_hash')<>fingerprint then raise exception 'WHATSAPP_EVENT_COLLISION';end if;
 duplicates:=duplicates+1;continue;end if;
 accepted:=accepted+1;
 if e->>'kind'='opt_out' then
 v_label:=e->>'contact_label';
 -- Lock invite before contact, matching OWNER operations; ordered locks avoid cross-partner deadlocks.
 for iid in select b.invite_id from partner_whatsapp.bindings b where b.label=v_label order by b.invite_id loop
 perform 1 from partner_portal.invites where id=iid for update;
 end loop;
 update partner_whatsapp.contacts c set suppressed=true where c.label=v_label;
 for iid in select b.invite_id from partner_whatsapp.bindings b where b.label=v_label order by b.invite_id loop
 update partner_portal.invites set opted_out=true,opt_in=false where id=iid;
 update partner_portal.messages set state='canceled' where invite_id=iid and state='pending';
 update partner_portal.sessions set revoked_at=now() where invite_id=iid and revoked_at is null;
 insert into partner_portal.events(invite_id,kind) values(iid,'whatsapp_opt_out_synthetic');
 insert into partner_whatsapp.audit(kind,invite_id) values('opt_out',iid);
 end loop;
 elsif e->>'kind'='status' then
 select * into o from partner_whatsapp.outbox where delivery_hash=e->>'delivery_hash' for update;
 v_state:=e->>'state';
 if o.id is not null and o.state in ('simulated','sent','delivered') and
 ((v_state='failed' and o.state in ('simulated','sent')) or
 (v_state='sent' and o.state='simulated') or
 (v_state='delivered' and o.state in ('simulated','sent')) or v_state='read') then
 update partner_whatsapp.outbox set state=v_state,updated_at=now() where id=o.id;
 insert into partner_whatsapp.audit(kind,invite_id) values('status',o.invite_id);
 end if;
 end if;
 end loop;
 return jsonb_build_object('ok',true,'accepted',accepted,'duplicates',duplicates,'reply_count',0,'ai_calls',0,'real_send',false);
end$$;
revoke all on function public.partner_whatsapp_ingest_test(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.partner_whatsapp_ingest_test(jsonb) to service_role;
revoke all on all functions in schema partner_whatsapp from public,anon,authenticated,service_role;
commit;
