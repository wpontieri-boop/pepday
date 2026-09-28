-- PepDay V3.0 / Bloco C — outbox de e-mail transacional (Brevo).
-- O outbox não armazena endereço de e-mail, nome ou dados de saúde.
-- O worker resolve o destinatário somente no backend no momento do envio.
begin;

create table public.transactional_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'account_created',
    'trial_started',
    'trial_ending',
    'trial_ended',
    'payment_approved',
    'renewal_approved',
    'payment_failed',
    'grace_ended',
    'subscription_canceled',
    'subscription_reactivated',
    'account_security'
  )),
  dedupe_key text not null unique check (length(trim(dedupe_key)) between 1 and 200),
  status text not null default 'pending'
    check (status in ('pending','processing','retry','sent','dead')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  available_at timestamptz not null default statement_timestamp(),
  locked_at timestamptz,
  worker_id uuid,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create index transactional_email_outbox_ready_idx
  on public.transactional_email_outbox(status,available_at,created_at);

alter table public.transactional_email_outbox enable row level security;
revoke all on public.transactional_email_outbox from public,anon,authenticated,service_role;

create or replace function public.enqueue_transactional_email(
  p_user_id uuid,
  p_event_type text,
  p_dedupe_key text,
  p_available_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  event_id uuid;
  stamp timestamptz:=statement_timestamp();
begin
  if p_user_id is null or not exists(select 1 from public.profiles where id=p_user_id) then
    raise exception 'Conta de e-mail transacional inválida';
  end if;

  if p_event_type not in (
    'account_created','trial_started','trial_ending','trial_ended',
    'payment_approved','renewal_approved','payment_failed','grace_ended',
    'subscription_canceled','subscription_reactivated','account_security'
  ) then
    raise exception 'Evento de e-mail transacional inválido';
  end if;

  if p_dedupe_key is null or length(trim(p_dedupe_key)) not between 1 and 200 then
    raise exception 'Chave de deduplicação inválida';
  end if;

  insert into public.transactional_email_outbox(
    user_id,event_type,dedupe_key,available_at
  ) values (
    p_user_id,p_event_type,trim(p_dedupe_key),coalesce(p_available_at,stamp)
  )
  on conflict(dedupe_key) do nothing
  returning id into event_id;

  if event_id is null then
    select id into event_id
    from public.transactional_email_outbox
    where dedupe_key=trim(p_dedupe_key);

    return jsonb_build_object(
      'outcome','duplicate',
      'id',event_id
    );
  end if;

  return jsonb_build_object(
    'outcome','queued',
    'id',event_id
  );
end $$;

revoke all on function public.enqueue_transactional_email(uuid,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.enqueue_transactional_email(uuid,text,text,timestamptz)
  to service_role;

create or replace function public.claim_transactional_email(
  p_worker_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  item public.transactional_email_outbox;
  p public.profiles;
  s public.subscriptions;
  t public.trials;
  stamp timestamptz:=statement_timestamp();
begin
  if p_worker_id is null then
    raise exception 'Worker inválido';
  end if;

  select *
  into item
  from public.transactional_email_outbox
  where attempts<5
    and (
      (status in ('pending','retry') and available_at<=stamp)
      or
      (status='processing' and locked_at<stamp-interval '15 minutes')
    )
  order by available_at,created_at
  for update skip locked
  limit 1;

  if item.id is null then
    return jsonb_build_object('outcome','empty');
  end if;

  update public.transactional_email_outbox
  set status='processing',
      attempts=attempts+1,
      locked_at=stamp,
      worker_id=p_worker_id,
      updated_at=stamp
  where id=item.id
  returning * into item;

  select * into p from public.profiles where id=item.user_id;
  select * into s from public.subscriptions where user_id=item.user_id;
  select * into t from public.trials where user_id=item.user_id;

  if p.id is null or p.email is null or length(trim(p.email))=0 then
    update public.transactional_email_outbox
    set status='dead',
        last_error_code='RECIPIENT_MISSING',
        updated_at=stamp
    where id=item.id;

    return jsonb_build_object(
      'outcome','dead',
      'id',item.id,
      'error_code','RECIPIENT_MISSING'
    );
  end if;

  return jsonb_build_object(
    'outcome','claimed',
    'id',item.id,
    'event_type',item.event_type,
    'attempt',item.attempts,
    'recipient',jsonb_build_object(
      'email',p.email,
      'name',coalesce(nullif(trim(p.name),''),'PepDay')
    ),
    'context',jsonb_build_object(
      'plan',s.plan,
      'subscription_status',s.status,
      'billing_status',s.billing_status,
      'period_end',s.current_period_end,
      'grace_until',s.grace_until,
      'trial_end',t.ends_at
    )
  );
end $$;

revoke all on function public.claim_transactional_email(uuid)
  from public,anon,authenticated;
grant execute on function public.claim_transactional_email(uuid)
  to service_role;

create or replace function public.complete_transactional_email(
  p_id uuid,
  p_worker_id uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_retry_after_seconds integer default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  item public.transactional_email_outbox;
  stamp timestamptz:=statement_timestamp();
  retry_seconds integer;
  final_status text;
begin
  if p_id is null or p_worker_id is null then
    raise exception 'Conclusão de e-mail inválida';
  end if;

  if p_outcome not in ('sent','retry','dead') then
    raise exception 'Resultado de e-mail inválido';
  end if;

  select * into item
  from public.transactional_email_outbox
  where id=p_id
  for update;

  if item.id is null
     or item.status<>'processing'
     or item.worker_id is distinct from p_worker_id then
    raise exception 'Lock do e-mail transacional inválido';
  end if;

  if p_provider_message_id is not null and length(p_provider_message_id)>300 then
    raise exception 'ID do provedor inválido';
  end if;

  if p_error_code is not null and length(p_error_code)>100 then
    raise exception 'Código de erro inválido';
  end if;

  if p_outcome='sent' then
    update public.transactional_email_outbox
    set status='sent',
        sent_at=stamp,
        provider_message_id=p_provider_message_id,
        last_error_code=null,
        worker_id=null,
        locked_at=null,
        updated_at=stamp
    where id=item.id;
    final_status:='sent';

  elsif p_outcome='retry' and item.attempts<5 then
    retry_seconds:=greatest(60,least(coalesce(p_retry_after_seconds,300),86400));

    update public.transactional_email_outbox
    set status='retry',
        available_at=stamp+(retry_seconds*interval '1 second'),
        last_error_code=coalesce(p_error_code,'RETRY'),
        worker_id=null,
        locked_at=null,
        updated_at=stamp
    where id=item.id;
    final_status:='retry';

  else
    update public.transactional_email_outbox
    set status='dead',
        last_error_code=coalesce(p_error_code,'DELIVERY_FAILED'),
        worker_id=null,
        locked_at=null,
        updated_at=stamp
    where id=item.id;
    final_status:='dead';
  end if;

  return jsonb_build_object(
    'outcome',final_status,
    'id',item.id
  );
end $$;

revoke all on function public.complete_transactional_email(uuid,uuid,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.complete_transactional_email(uuid,uuid,text,text,text,integer)
  to service_role;

commit;
