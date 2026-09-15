-- PepDay V3 / B2.1: privilégios mínimos do runner administrativo de validação.
-- Não altera RLS nem os privilégios de public, anon ou authenticated.
begin;

grant usage on schema public to service_role;

grant select on table
  public.profiles,
  public.subscriptions,
  public.trials,
  public.settings,
  public.vials,
  public.routines,
  public.routine_versions,
  public.applications,
  public.vial_movements,
  public.local_data_imports,
  public.legacy_import_records,
  public.audit_logs
to service_role;

grant insert on table
  public.local_data_imports,
  public.vials,
  public.routines,
  public.routine_versions
to service_role;

commit;
