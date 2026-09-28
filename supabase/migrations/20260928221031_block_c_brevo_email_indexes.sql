begin;

create index transactional_email_outbox_user_idx
  on public.transactional_email_outbox(user_id,created_at desc);

commit;
