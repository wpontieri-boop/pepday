begin;
create function public.revoke_recovery_marketing_consent() returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Autenticação necessária';end if;
  update public.settings set marketing_opt_in=false,marketing_accepted_at=null,version=version+1,updated_at=statement_timestamp()
    where user_id=auth.uid();
end $$;
revoke all on function public.revoke_recovery_marketing_consent() from public,anon,authenticated,service_role;
grant execute on function public.revoke_recovery_marketing_consent() to authenticated;
commit;
