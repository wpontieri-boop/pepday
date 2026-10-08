-- TEST only: read the caller's definitive attribution without granting a benefit.
begin;
create function public.get_my_partner_attribution() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb;
begin
 if u is null then raise exception 'Autenticação necessária' using errcode='42501';end if;
 select jsonb_build_object('partner_locked',true,'partner',case when p.id is null then null
  else jsonb_build_object('public_name',p.public_name,'city',p.city,'description',p.description) end)
 into result from public.partner_attributions a
 left join public.partners p on p.id=a.partner_id where a.user_id=u;
 return coalesce(result,jsonb_build_object('partner_locked',false,'partner',null));
end $$;
revoke all on function public.get_my_partner_attribution() from public,anon,authenticated,service_role;
grant execute on function public.get_my_partner_attribution() to authenticated;
comment on function public.get_my_partner_attribution() is 'Own public attribution only; read-only, no card grant or referral mutation.';
commit;
