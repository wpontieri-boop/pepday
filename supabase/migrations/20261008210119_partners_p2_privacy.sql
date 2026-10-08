-- P2 TEST: own-data export only. Preserve the existing export/audit verbatim.
begin;
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='pepday_supabase_project_url' and decrypted_secret='https://fsbqpyyprtymwrmzsacp.supabase.co') then raise exception 'PARTNERS_TEST_ONLY';end if;
end $$;
alter function public.export_my_data() rename to export_my_data_core_p2;
revoke all on function public.export_my_data_core_p2() from public,anon,authenticated,service_role;
create function public.export_my_data() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 result:=public.export_my_data_core_p2();
 return result||jsonb_build_object('partner_attribution',(
  select jsonb_build_object('source',a.source,'locked_at',a.locked_at,'partner',case when p.id is null then null else
   jsonb_build_object('public_name',p.public_name,'city',p.city,'description',p.description,'slug',p.slug,'public_code',p.public_code) end)
  from public.partner_attributions a left join public.partners p on p.id=a.partner_id where a.user_id=auth.uid()
 ));
end $$;
revoke all on function public.export_my_data() from public,anon,authenticated,service_role;
grant execute on function public.export_my_data() to authenticated;
commit;
