-- PepDay V3.0 / Bloco C — política de recuperação pós-trial.
-- E-mails ligados ao fim do trial são comunicação comercial e exigem opt-in atual.
-- A checagem ocorre tanto ao enfileirar quanto novamente imediatamente antes do envio.
begin;

alter table public.transactional_email_outbox
  drop constraint if exists transactional_email_outbox_status_check;

alter table public.transactional_email_outbox
  add constraint transactional_email_outbox_status_check
  check (status in ('pending','processing','retry','sent','dead','suppressed'));

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
  marketing_allowed boolean:=false;
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

  if p_event_type in ('trial_ending','trial_ended') then
    select coalesce(s.marketing_opt_in,false)
      into marketing_allowed
    from public.settings s
    where s.user_id=p_user_id;

    if marketing_allowed is not true then
      return jsonb_build_object(
        'outcome','suppressed',
        'error_code','MARKETING_CONSENT_REQUIRED'
      );
    end if;
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
  marketing_allowed boolean:=false;
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

  if item.event_type in ('trial_ending','trial_ended') then
    select coalesce(st.marketing_opt_in,false)
      into marketing_allowed
    from public.settings st
    where st.user_id=item.user_id;

    if marketing_allowed is not true then
      update public.transactional_email_outbox
      set status='suppressed',
          last_error_code='MARKETING_CONSENT_REQUIRED',
          worker_id=null,
          locked_at=null,
          updated_at=stamp
      where id=item.id;

      return jsonb_build_object(
        'outcome','suppressed',
        'id',item.id,
        'error_code','MARKETING_CONSENT_REQUIRED'
      );
    end if;
  end if;

  if p.id is null or p.email is null or length(trim(p.email))=0 then
    update public.transactional_email_outbox
    set status='dead',
        last_error_code='RECIPIENT_MISSING',
        worker_id=null,
        locked_at=null,
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

commit;
