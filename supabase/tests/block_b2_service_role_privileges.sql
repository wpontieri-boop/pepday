-- Verificação somente leitura dos privilégios mínimos usados pelo runner B2.1.
do $$
declare
  table_name text;
  role_name text;
  select_tables constant text[] := array[
    'profiles','subscriptions','trials','settings','vials','routines',
    'routine_versions','applications','vial_movements','local_data_imports',
    'legacy_import_records','audit_logs'
  ];
  insert_tables constant text[] := array[
    'local_data_imports','vials','routines','routine_versions'
  ];
begin
  if not has_schema_privilege('service_role','public','USAGE') then
    raise exception 'service_role sem USAGE no schema public';
  end if;

  if not coalesce((select rolbypassrls from pg_roles where rolname='service_role'),false) then
    raise exception 'service_role não possui BYPASSRLS';
  end if;

  foreach table_name in array select_tables loop
    if not coalesce((select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name),false) then
      raise exception 'RLS não está habilitada em public.%',table_name;
    end if;
    if not has_table_privilege('service_role',format('public.%I',table_name),'SELECT') then
      raise exception 'service_role sem SELECT em public.%',table_name;
    end if;
    if has_table_privilege('service_role',format('public.%I',table_name),'UPDATE')
      or has_table_privilege('service_role',format('public.%I',table_name),'DELETE') then
      raise exception 'service_role possui UPDATE/DELETE indevido em public.%',table_name;
    end if;
    if table_name=any(insert_tables) then
      if not has_table_privilege('service_role',format('public.%I',table_name),'INSERT') then
        raise exception 'service_role sem INSERT em public.%',table_name;
      end if;
    elsif has_table_privilege('service_role',format('public.%I',table_name),'INSERT') then
      raise exception 'service_role possui INSERT indevido em public.%',table_name;
    end if;

    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name,format('public.%I',table_name),'INSERT')
        or has_table_privilege(role_name,format('public.%I',table_name),'UPDATE')
        or has_table_privilege(role_name,format('public.%I',table_name),'DELETE') then
        raise exception '% possui escrita direta indevida em public.%',role_name,table_name;
      end if;
    end loop;
  end loop;
end $$;

select 'PASS — privilégios mínimos do service_role confirmados' as resultado;
