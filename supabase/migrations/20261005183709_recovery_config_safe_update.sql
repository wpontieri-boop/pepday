begin;
create or replace function public.configure_recovery_test(p_templates jsonb,p_provider_ready boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.recovery_config set template_ids=p_templates,provider_ready=p_provider_ready,enabled=true where singleton is true;
end $$;
revoke all on function public.configure_recovery_test(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.configure_recovery_test(jsonb,boolean) to service_role;
commit;
