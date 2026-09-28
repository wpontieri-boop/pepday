begin;

revoke all on function public.rls_auto_enable() from public,anon,authenticated,service_role;
grant execute on function public.rls_auto_enable() to postgres;

commit;
