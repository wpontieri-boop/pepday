-- PepDay V3.0 / Bloco C — códigos promocionais únicos de uso único.
begin;

update public.promo_codes
set active=false, updated_at=statement_timestamp()
where code in ('AMIGO30','AMIGO60','AMIGO90') and active=true;

revoke execute on function public.admin_create_promo_code(
  text,integer,integer,timestamptz,text
) from authenticated;

create or replace function public.admin_generate_promo_code(
  p_duration_days integer,
  p_expires_at timestamptz default null,
  p_exclusive_email text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  exclusive_id uuid;
  generated_code text;
  created public.promo_codes;
  stamp timestamptz:=statement_timestamp();
  attempt integer:=0;
begin
  if u is null or not exists(
    select 1 from public.profiles where id=u and role='admin'
  ) then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;
  if p_duration_days not in (30,60,90) then
    raise exception 'Duração promocional inválida';
  end if;
  if p_expires_at is not null and p_expires_at<=stamp then
    raise exception 'A validade precisa estar no futuro';
  end if;

  if nullif(trim(coalesce(p_exclusive_email,'')),'') is not null then
    select id into exclusive_id from public.profiles
    where lower(email)=lower(trim(p_exclusive_email)) limit 1;
    if exclusive_id is null then
      raise exception 'Conta exclusiva não encontrada';
    end if;
  end if;

  loop
    attempt:=attempt+1;
    generated_code:='AMIGO'||p_duration_days||'-'||
      upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    begin
      insert into public.promo_codes(
        code,duration_days,max_redemptions,expires_at,
        exclusive_user_id,active,created_by
      ) values (
        generated_code,p_duration_days,1,p_expires_at,
        exclusive_id,true,u
      ) returning * into created;
      exit;
    exception when unique_violation then
      if attempt>=5 then raise; end if;
    end;
  end loop;

  insert into public.audit_logs(user_id,action)
  values(u,'promo_code_generated');

  return jsonb_build_object(
    'code',created.code,
    'duration_days',created.duration_days,
    'max_redemptions',created.max_redemptions,
    'redemption_count',created.redemption_count,
    'active',created.active,
    'expires_at',created.expires_at,
    'exclusive',created.exclusive_user_id is not null,
    'created_at',created.created_at
  );
end $$;

revoke all on function public.admin_generate_promo_code(
  integer,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.admin_generate_promo_code(
  integer,timestamptz,text
) to authenticated;create or replace function public.get_admin_promo_codes() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  result jsonb;
  stamp timestamptz:=statement_timestamp();
begin
  if u is null or not exists(
    select 1 from public.profiles where id=u and role='admin'
  ) then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code',pc.code,
    'duration_days',pc.duration_days,
    'max_redemptions',pc.max_redemptions,
    'redemption_count',pc.redemption_count,
    'remaining',greatest(pc.max_redemptions-pc.redemption_count,0),
    'active',pc.active,
    'status',case
      when pc.redemption_count>=pc.max_redemptions then 'used'
      when not pc.active then 'disabled'
      when pc.expires_at is not null and pc.expires_at<=stamp then 'expired'
      else 'available'
    end,
    'valid_from',pc.valid_from,
    'expires_at',pc.expires_at,
    'exclusive',pc.exclusive_user_id is not null,
    'created_at',pc.created_at
  ) order by pc.created_at desc),'[]'::jsonb)
  into result
  from public.promo_codes pc;

  return result;
end $$;

revoke all on function public.get_admin_promo_codes()
  from public,anon,authenticated;
grant execute on function public.get_admin_promo_codes()
  to authenticated;

commit;
