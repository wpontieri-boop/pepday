begin;

alter table public.applications drop constraint applications_owner_routine_version_fkey;
alter table public.applications add constraint applications_owner_routine_version_fkey
  foreign key (user_id,routine_id,routine_version_id)
  references public.routine_versions(user_id,routine_id,id) on delete cascade;

alter table public.applications drop constraint applications_user_id_routine_id_fkey;
alter table public.applications add constraint applications_user_id_routine_id_fkey
  foreign key (user_id,routine_id)
  references public.routines(user_id,id) on delete cascade;

alter table public.applications drop constraint applications_user_id_routine_version_id_fkey;
alter table public.applications add constraint applications_user_id_routine_version_id_fkey
  foreign key (user_id,routine_version_id)
  references public.routine_versions(user_id,id) on delete cascade;

alter table public.applications drop constraint applications_user_id_vial_id_fkey;
alter table public.applications add constraint applications_user_id_vial_id_fkey
  foreign key (user_id,vial_id)
  references public.vials(user_id,id) on delete cascade;

alter table public.routine_versions drop constraint routine_versions_user_id_routine_id_fkey;
alter table public.routine_versions add constraint routine_versions_user_id_routine_id_fkey
  foreign key (user_id,routine_id)
  references public.routines(user_id,id) on delete cascade;

alter table public.routines drop constraint routines_user_id_vial_id_fkey;
alter table public.routines add constraint routines_user_id_vial_id_fkey
  foreign key (user_id,vial_id)
  references public.vials(user_id,id) on delete cascade;

alter table public.vial_movements drop constraint vial_movements_user_id_vial_id_fkey;
alter table public.vial_movements add constraint vial_movements_user_id_vial_id_fkey
  foreign key (user_id,vial_id)
  references public.vials(user_id,id) on delete cascade;

alter table public.vial_movements drop constraint vial_movements_user_id_application_id_fkey;
alter table public.vial_movements add constraint vial_movements_user_id_application_id_fkey
  foreign key (user_id,application_id)
  references public.applications(user_id,id) on delete cascade;

alter table public.legacy_import_records drop constraint legacy_import_records_import_id_fkey;
alter table public.legacy_import_records add constraint legacy_import_records_import_id_fkey
  foreign key (import_id)
  references public.local_data_imports(id) on delete cascade;

alter function public.pepday_assert_version_keeps_current_routine() security definer;
revoke all on function public.pepday_assert_version_keeps_current_routine() from public,anon,authenticated,service_role;
grant execute on function public.pepday_assert_version_keeps_current_routine() to postgres;

commit;
