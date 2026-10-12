-- TEST-only portal hardening; no P1/P2/P3/Auth changes and no real collection.
begin;
select partner_portal.assert_test();
create function partner_portal.consume_budget(k text,cap integer) returns boolean
language plpgsql set search_path='' as $$
declare r partner_portal.rates;
begin
 if cap not in (20,200) or length(k)>90 then raise exception 'PORTAL_RATE_SCOPE';end if;
 insert into partner_portal.rates(key) values(k) on conflict do nothing;
 select * into r from partner_portal.rates where key=k for update;
 if r.window_start<now()-interval '1 hour' then update partner_portal.rates set window_start=now(),count=1 where key=k;return true;end if;
 if r.count>=cap then return false;end if;
 update partner_portal.rates set count=count+1 where key=k;return true;
end$$;
create function partner_portal.request_budget(invite text) returns boolean
language plpgsql set search_path='' as $$
begin
 if coalesce(invite,'')!~'^[A-Za-z0-9_-]{43}$' then return false;end if;
 -- One shared gate plus token-bound quota: forged transport/IP headers cannot make a fresh budget.
 if not partner_portal.consume_budget('global:portal-test-v1',200) then return false;end if;
 return partner_portal.consume_budget('invite:'||partner_portal.hash(invite),20);
end$$;
revoke all on function partner_portal.consume_budget(text,integer),partner_portal.request_budget(text) from public,anon,authenticated,service_role;
do $patch$
declare s text;before text;
begin
 s:=pg_get_functiondef('public.partner_portal_exchange(jsonb)'::regprocedure);before:=s;
 if strpos(s,'partner_portal.rate(p_request->>''ip_hash'')')=0 then raise exception 'PORTAL_PATCH_BASE_MISMATCH';end if;
 s:=replace(s,'partner_portal.rate(p_request->>''ip_hash'')','partner_portal.request_budget(p_request->>''invite'')');
 s:=replace(s,' or i.opted_out or i.completed_at',' or i.completed_at');
 s:=replace(s,' update partner_portal.sessions set revoked_at=now() where invite_id=iid;',' -- Opt-out cancels the channel, not an authenticated portal session.');
 if s=before then raise exception 'PORTAL_PATCH_NOT_APPLIED';end if;execute s;
 s:=pg_get_functiondef('partner_portal.authorize(text)'::regprocedure);
 if strpos(s,'and not i.opted_out')=0 then raise exception 'PORTAL_AUTH_PATCH_BASE_MISMATCH';end if;
 s:=replace(s,' and not i.opted_out','');s:=replace(s,' and not opted_out','');execute s;
 s:=pg_get_functiondef('public.admin_partner_portal(jsonb)'::regprocedure);
 if strpos(s,'or i.opted_out or i.completed_at')=0 then raise exception 'PORTAL_ADMIN_PATCH_BASE_MISMATCH';end if;
 s:=replace(s,' or i.opted_out or i.completed_at',' or i.completed_at');execute s;
 s:=pg_get_functiondef('public.partner_whatsapp_ingest_test(jsonb)'::regprocedure);
 if strpos(s,'update partner_portal.sessions set revoked_at=now() where invite_id=iid and revoked_at is null;')=0 then raise exception 'PORTAL_CHANNEL_PATCH_BASE_MISMATCH';end if;
 s:=replace(s,'update partner_portal.sessions set revoked_at=now() where invite_id=iid and revoked_at is null;','-- Channel opt-out does not revoke the portal session.');execute s;
end$patch$;
-- Still no legal acceptance, real contacts, real documents or sends.
commit;
