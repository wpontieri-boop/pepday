-- P1 TEST only: no benefit attribution, billing, commission or payout mutation.
begin;
do $$begin
  if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url'
    and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then
    raise exception 'PARTNERS_TEST_ONLY';
  end if;
end $$;

drop function public.admin_list_partners(text);
create function public.admin_list_partners(p_query text default '',p_include_archived boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare level text;begin
  level:=public.partner_admin_assert(false,false);
  if length(p_query)>100 then raise exception 'PARTNER_INVALID_QUERY'; end if;
  return coalesce((select jsonb_agg(item order by case item->>'status' when 'active' then 0 when 'draft' then 1 when 'suspended' then 2 else 3 end,item->>'public_name',item->>'id') from (
    select jsonb_build_object('id',p.id,'public_name',p.public_name,'partner_type',p.partner_type,
      'city',p.city,'description',p.description,'slug',p.slug,'public_code',p.public_code,'status',p.status,
      'commission_percent',(select r.commission_percent from public.partner_commission_rules r where r.partner_id=p.id order by version desc limit 1),
      'financial_ready',v.verified_at is not null,'requires_stepup',p.first_activated_at is not null,
      'financial',case when level='owner' and v.verified_at is not null then jsonb_build_object('legal_name',v.legal_name,'document_masked','••••'||right(v.document,4),'payee_name_masked','••••••••','pix_type',v.pix_type,'pix_key_masked',case when length(v.pix_key)>8 then '••••'||right(v.pix_key,4) else '••••••••' end) else null end,
      'contact',case when level='viewer' then null else jsonb_build_object('name',v.contact_name,'email',v.email,'phone',v.phone) end,
      'document_masked',case when level='viewer' then null when v.document is null then null else '••••'||right(v.document,4) end) item
    from public.partners p join public.partner_private_profiles v on v.partner_id=p.id
    where (coalesce(p_include_archived,false) or p.status<>'archived') and strpos(lower(p.public_name||' '||p.city||' '||p.public_code),lower(trim(coalesce(p_query,''))))>0
    order by case p.status when 'active' then 0 when 'draft' then 1 when 'suspended' then 2 else 3 end,p.public_name,p.id limit 100
  ) s),'[]'::jsonb);
end $$;
revoke all on function public.admin_list_partners(text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_partners(text,boolean) to authenticated;

create or replace function public.admin_configure_partner(p_id uuid,p_payload jsonb,p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d text; pct numeric; v integer; old_pct numeric; changed integer; critical boolean; requested jsonb:=p_payload; profile public.partner_private_profiles%rowtype; profile_changed boolean;
begin
  perform public.partner_admin_assert(true,true);
  perform 1 from public.partners where id=p_id and status<>'archived' for update;
  if not found then raise exception 'PARTNER_NOT_EDITABLE'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (p_payload-array['legal_name','document','pix_type','pix_key','payee_name','commission_percent','reason'])<>'{}'::jsonb then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  -- Keep the caller's patch for ticket binding. Omitted fields come only from the locked server row.
  -- Explicit null/empty values are invalid replacements, never an instruction to erase/retain data.
  if octet_length(p_payload::text)>4096 or not (p_payload ? 'reason')
    or (p_payload-'reason')='{}'::jsonb
    or exists(select 1 from jsonb_each(p_payload) e where jsonb_typeof(e.value) not in ('string','number') or e.value='null'::jsonb)
    then raise exception 'PARTNER_INVALID_FINANCIAL_DATA'; end if;
  if (p_payload ? 'pix_type') and not (p_payload ? 'pix_key') then raise exception 'PARTNER_INVALID_PIX'; end if;
  select * into strict profile from public.partner_private_profiles where partner_id=p_id for update;
  select commission_percent into old_pct from public.partner_commission_rules where partner_id=p_id order by version desc limit 1;
  p_payload:=jsonb_build_object('legal_name',profile.legal_name,'document',profile.document,
    'payee_name',profile.payee_name,'pix_type',profile.pix_type,'pix_key',profile.pix_key,
    'commission_percent',old_pct)||p_payload;
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
      and payload_hash=encode(sha256(convert_to(requested::text,'UTF8')),'hex');
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'PARTNER_STEPUP_INVALID' using errcode='42501'; end if;
  end if;
  select coalesce(max(version),0)+1 into v from public.partner_commission_rules where partner_id=p_id;
  select commission_percent into old_pct from public.partner_commission_rules where partner_id=p_id order by version desc limit 1;
  profile_changed:=row(profile.legal_name,profile.document,profile.pix_type,profile.pix_key,profile.payee_name)
    is distinct from row(trim(p_payload->>'legal_name'),d,p_payload->>'pix_type',trim(p_payload->>'pix_key'),trim(p_payload->>'payee_name'));
  if profile_changed or profile.verified_at is null then
  update public.partner_private_profiles set legal_name=trim(p_payload->>'legal_name'),document=d,
    pix_type=p_payload->>'pix_type',pix_key=trim(p_payload->>'pix_key'),payee_name=trim(p_payload->>'payee_name'),version=version+1,verified_by=auth.uid(),verified_at=statement_timestamp() where partner_id=p_id;
  end if;
  if old_pct is distinct from pct then
  insert into public.partner_commission_rules(partner_id,version,commission_percent,created_by) values(p_id,v,pct,auth.uid());
  else v:=v-1; end if;
  insert into public.admin_audit_logs(actor_user_id,action,metadata) values(auth.uid(),'partner_financial_configured',
    jsonb_build_object('partner_id',p_id,'rule_version',v,'old_percent',old_pct,'new_percent',pct,'document_masked','••••'||right(d,4),'authorization',case when critical then 'critical_stepup' when p_ticket is not null then 'explicit_stepup' else 'operational_login' end,'payment_profile_changed',profile_changed,'reason',p_payload->>'reason'));
  return jsonb_build_object('configured',true,'rule_version',v);
end $$;
commit;
