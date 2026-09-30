-- PepDay V3.0 / mobile QA — reidrata estado do aparelho de push sem expor a tabela.
begin;

create or replace function public.get_push_installation_status(
  p_installation_id text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  value text:=trim(coalesce(p_installation_id,''));
  installation_active boolean;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;
  if length(value) not between 16 and 512
     or value !~ '^[A-Za-z0-9_:\\.-]+$' then
    raise exception 'Identificador de push inválido';
  end if;

  select i.active into installation_active
  from public.push_installations i
  where i.user_id=u and i.installation_id=value;

  return jsonb_build_object('active',coalesce(installation_active,false));
end $$;

revoke all on function public.get_push_installation_status(text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_push_installation_status(text)
  to authenticated;

commit;
