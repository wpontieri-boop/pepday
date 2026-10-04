-- PepDay V3 — índices de apoio para FKs da equipe administrativa.
begin;

create index admin_audit_logs_actor_idx
  on public.admin_audit_logs(actor_user_id);

create index admin_audit_logs_target_idx
  on public.admin_audit_logs(target_user_id)
  where target_user_id is not null;

create index admin_memberships_created_by_idx
  on public.admin_memberships(created_by)
  where created_by is not null;

commit;
