-- P1 TEST only: no benefit attribution, billing, commission or payout mutation.
begin;
do $$begin
  if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url'
    and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then
    raise exception 'PARTNERS_TEST_ONLY';
  end if;
end $$;

alter table public.partners add column first_activated_at timestamptz;
-- Conservative backfill protects previously operational partners, including suspended ones.
update public.partners set first_activated_at=updated_at where status<>'draft'
  or exists(select 1 from public.admin_audit_logs a where a.action='partner_status_changed'
    and a.metadata->>'partner_id'=partners.id::text and a.metadata->>'to'='active');
alter table public.partner_private_profiles add column contact_name text not null default '' check(length(contact_name)<=120);
-- A valid login is bounded by server session creation AND signed password/TOTP proofs.
-- Token refresh or a later MFA challenge cannot extend the eight-hour window.
create function public.partner_assert_operational_login() returns void
language plpgsql security definer set search_path='' as $$
declare proof jsonb; stamp numeric; pwd boolean:=false; totp boolean:=false;
begin
  if not exists(select 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid
    and user_id=auth.uid() and created_at>statement_timestamp()-interval '8 hours'
    and created_at<=statement_timestamp()+interval '5 seconds'
    and (not_after is null or not_after>statement_timestamp())) then
    raise exception 'PARTNER_LOGIN_EXPIRED' using errcode='42501';
  end if;
  for proof in select value from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) loop
    if (proof->>'timestamp') ~ '^[0-9]+$' then
      stamp:=(proof->>'timestamp')::numeric;
      if stamp>extract(epoch from statement_timestamp())-28800 and stamp<=extract(epoch from statement_timestamp())+5 then
        pwd:=pwd or proof->>'method'='password'; totp:=totp or proof->>'method'='totp';
      end if;
    end if;
  end loop;
  if not pwd or not totp or not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified' and factor_type='totp') then
    raise exception 'PARTNER_LOGIN_EXPIRED' using errcode='42501';
  end if;
end $$;
revoke all on function public.partner_assert_operational_login() from public,anon,authenticated,service_role;

create or replace function public.partner_admin_assert(p_write boolean default false,p_owner boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare level text; sid uuid;
begin
  if coalesce(auth.jwt()->>'iss','')<>'https://fsbqpyyprtymwrmzsacp.supabase.co/auth/v1' then
    raise exception 'PARTNERS_TEST_ONLY' using errcode='42501';
  end if;
  level:=public.admin_assert_access(p_write,p_owner);
  sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  if sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid()) then
    raise exception 'PARTNER_SESSION_REVOKED' using errcode='42501';
  end if;
  if not exists(select 1 from public.partner_config where enabled) then
    raise exception 'PARTNERS_DISABLED' using errcode='42501';
  end if;
  perform public.partner_assert_operational_login();
  return level;
end $$;
create or replace function public.admin_list_partners(p_query text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare level text;begin
  level:=public.partner_admin_assert(false,false);
  if length(p_query)>100 then raise exception 'PARTNER_INVALID_QUERY'; end if;
  return coalesce((select jsonb_agg(item order by item->>'public_name') from (
    select jsonb_build_object('id',p.id,'public_name',p.public_name,'partner_type',p.partner_type,
      'city',p.city,'description',p.description,'slug',p.slug,'public_code',p.public_code,'status',p.status,
      'commission_percent',(select r.commission_percent from public.partner_commission_rules r where r.partner_id=p.id order by version desc limit 1),
      'financial_ready',v.verified_at is not null,'requires_stepup',p.first_activated_at is not null,
      'contact',case when level='viewer' then null else jsonb_build_object('name',v.contact_name,'email',v.email,'phone',v.phone) end,
      'document_masked',case when level='viewer' then null when v.document is null then null else '••••'||right(v.document,4) end) item
    from public.partners p join public.partner_private_profiles v on v.partner_id=p.id
    where strpos(lower(p.public_name||' '||p.city||' '||p.public_code),lower(trim(coalesce(p_query,''))))>0
    order by p.public_name,p.id limit 100
  ) s),'[]'::jsonb);
end $$;
create or replace function public.admin_save_partner(p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid:=p_id; base text; suffix text; short_code text; old_status text;
begin
  perform public.partner_admin_assert(true,false);
  if jsonb_typeof(p_data)<>'object' or p_data is null or (p_data-array['public_name','partner_type','city','description','email','phone','contact_name'])<>'{}'::jsonb
    or length(trim(coalesce(p_data->>'public_name','')))<2
    or length(coalesce(p_data->>'contact_name',''))>120 or length(coalesce(p_data->>'email',''))>254 or length(coalesce(p_data->>'phone',''))>30 then raise exception 'PARTNER_INVALID_DATA'; end if;
  if coalesce(p_data->>'email','')<>'' and (p_data->>'email')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'PARTNER_INVALID_EMAIL'; end if;
  if pid is null then
    pid:=gen_random_uuid(); suffix:=replace(pid::text,'-','');
    base:=trim(both '-' from regexp_replace(lower(translate(p_data->>'public_name','áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')),'[^a-z0-9]+','-','g'));
    if length(base)<2 then base:='parceiro'; end if;
    base:=left(base,60);
    -- Advisory lock serializes identical names; UUID suffix protects every collision.
    perform pg_advisory_xact_lock(hashtextextended(base,0));
    if exists(select 1 from public.partners where slug=left(base,60)) then base:=left(base,60)||'-'||suffix; end if;
    loop
      short_code:=upper(left(replace(gen_random_uuid()::text,'-',''),8));
      perform pg_advisory_xact_lock(hashtextextended(short_code,1));
      exit when not exists(select 1 from public.partners where public_code=short_code);
    end loop;
    insert into public.partners(id,public_name,partner_type,city,description,slug,public_code,created_by)
    values(pid,trim(p_data->>'public_name'),p_data->>'partner_type',trim(coalesce(p_data->>'city','')),trim(coalesce(p_data->>'description','')),left(base,100),short_code,auth.uid());
    insert into public.partner_private_profiles(partner_id,contact_name,email,phone) values(pid,trim(coalesce(p_data->>'contact_name','')),lower(trim(coalesce(p_data->>'email',''))),trim(coalesce(p_data->>'phone','')));
  else
    select status into old_status from public.partners where id=pid for update;
    if old_status is null or old_status='archived' then raise exception 'PARTNER_NOT_EDITABLE'; end if;
    update public.partners set public_name=trim(p_data->>'public_name'),partner_type=p_data->>'partner_type',city=trim(coalesce(p_data->>'city','')),description=trim(coalesce(p_data->>'description','')),updated_at=statement_timestamp() where id=pid;
    update public.partner_private_profiles set contact_name=trim(coalesce(p_data->>'contact_name','')),email=lower(trim(coalesce(p_data->>'email',''))),phone=trim(coalesce(p_data->>'phone','')) where partner_id=pid;
  end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_saved',jsonb_build_object('partner_id',pid,'created',p_id is null));
  return pid;
end $$;
create or replace function public.admin_configure_partner(p_id uuid,p_payload jsonb,p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d text; pct numeric; v integer; old_pct numeric; changed integer; critical boolean;
begin
  perform public.partner_admin_assert(true,true);
  perform 1 from public.partners where id=p_id and status<>'archived' for update;
  if not found then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (p_payload-array['legal_name','document','pix_type','pix_key','payee_name','commission_percent','reason'])<>'{}'::jsonb then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  d:=upper(regexp_replace(coalesce(p_payload->>'document',''),'[. /-]','','g'));
  if not public.partner_document_valid(d) or length(trim(coalesce(p_payload->>'legal_name',''))) not between 2 and 160
    or length(trim(coalesce(p_payload->>'payee_name',''))) not between 2 and 160
    or coalesce(p_payload->>'reason','') not in ('configuracao_inicial','ajuste_contratual','correcao_pagamento')
    or coalesce(p_payload->>'commission_percent','')!~ '^([0-9]{1,3})(\.[0-9]{1,2})?$' then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  pct:=(p_payload->>'commission_percent')::numeric;
  if pct<0 or pct>100 then raise exception 'PARTNER_INVALID_PERCENT'; end if;
  if length(coalesce(p_payload->>'pix_key','')) not between 3 and 254 or
    (case p_payload->>'pix_type'
      when 'cpf' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>11
      when 'cnpj' then not public.partner_document_valid(p_payload->>'pix_key') or length(p_payload->>'pix_key')<>14
      when 'email' then (p_payload->>'pix_key')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      when 'phone' then (p_payload->>'pix_key')!~ '^\+[0-9]{10,15}$'
      when 'random' then (p_payload->>'pix_key')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      else true end) then raise exception 'PARTNER_INVALID_PIX'; end if;
  select first_activated_at is not null into critical from public.partners where id=p_id;
  if critical and p_ticket is null then raise exception 'PARTNER_STEPUP_REQUIRED' using errcode='42501'; end if;
  if critical or p_ticket is not null then
  update public.partner_stepup_tickets set used_at=statement_timestamp()
    where id=p_ticket and actor_id=auth.uid() and session_id=(auth.jwt()->>'session_id')::uuid and partner_id=p_id
      and used_at is null and expires_at>statement_timestamp()
      and payload_hash=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'PARTNER_STEPUP_INVALID' using errcode='42501'; end if;
  end if;
  select coalesce(max(version),0)+1 into v from public.partner_commission_rules where partner_id=p_id;
  select commission_percent into old_pct from public.partner_commission_rules where partner_id=p_id order by version desc limit 1;
  update public.partner_private_profiles set legal_name=trim(p_payload->>'legal_name'),document=d,
    pix_type=p_payload->>'pix_type',pix_key=trim(p_payload->>'pix_key'),payee_name=trim(p_payload->>'payee_name'),version=version+1,verified_by=auth.uid(),verified_at=statement_timestamp() where partner_id=p_id;
  insert into public.partner_commission_rules(partner_id,version,commission_percent,created_by) values(p_id,v,pct,auth.uid());
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_financial_configured',
    jsonb_build_object('partner_id',p_id,'rule_version',v,'old_percent',old_pct,'new_percent',pct,'document_masked','••••'||right(d,4),'authorization',case when critical then 'critical_stepup' when p_ticket is not null then 'explicit_stepup' else 'operational_login' end,'payment_profile_changed',true,'reason',p_payload->>'reason'));
  return jsonb_build_object('configured',true,'rule_version',v);
end $$;
create or replace function public.admin_set_partner_status(p_id uuid,p_status text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare old text;begin
  perform public.partner_admin_assert(true,false);
  if p_status is null or p_status not in ('active','suspended','archived') or p_reason is null or p_reason not in ('cadastro_concluido','pausa_comercial','encerramento','ajuste_cadastral') then raise exception 'PARTNER_INVALID_STATUS'; end if;
  select status into old from public.partners where id=p_id for update;
  if old is null or old='archived' then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_status='active' and not exists(select 1 from public.partner_private_profiles v
      where v.partner_id=p_id and v.verified_at is not null and v.email<>'' and v.phone<>''
        and exists(select 1 from public.partner_commission_rules r where r.partner_id=p_id)) then raise exception 'PARTNER_FINANCIAL_CONFIGURATION_REQUIRED'; end if;
  update public.partners set status=p_status,first_activated_at=case when p_status='active' then coalesce(first_activated_at,statement_timestamp()) else first_activated_at end,updated_at=statement_timestamp() where id=p_id;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_status_changed',jsonb_build_object('partner_id',p_id,'from',old,'to',p_status,'reason',p_reason));
end $$;
commit;
