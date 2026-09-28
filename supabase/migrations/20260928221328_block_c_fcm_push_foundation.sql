-- PepDay V3.0 / Bloco C — fundação de push FCM.
-- Push é opcional, respeita settings do usuário e nunca carrega substância/dose/histórico.
begin;

alter table public.settings
  add column operational_notices boolean not null default true;

create table public.push_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'fcm' check (provider='fcm'),
  installation_id text not null unique
    check (length(trim(installation_id)) between 16 and 512),
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  last_seen_at timestamptz not null default statement_timestamp(),
  disabled_at timestamptz
);

create index push_installations_user_active_idx
  on public.push_installations(user_id,active,last_seen_at desc);

alter table public.push_installations enable row level security;
revoke all on public.push_installations from public,anon,authenticated,service_role;

create table public.push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  push_installation_id uuid not null references public.push_installations(id) on delete cascade,
  event_type text not null check (event_type in (
    'routine_due','refill_due','operational','account_security'
  )),
  dedupe_key text not null unique check (length(trim(dedupe_key)) between 1 and 240),
  status text not null default 'pending'
    check (status in ('pending','processing','retry','sent','dead','skipped')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  available_at timestamptz not null default statement_timestamp(),
  locked_at timestamptz,
  worker_id uuid,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(user_id,push_installation_id,dedupe_key)
);

create index push_notification_outbox_ready_idx
  on public.push_notification_outbox(status,available_at,created_at);
create index push_notification_outbox_user_idx
  on public.push_notification_outbox(user_id,created_at desc);
create index push_notification_outbox_installation_idx
  on public.push_notification_outbox(push_installation_id,created_at desc);

alter table public.push_notification_outbox enable row level security;
revoke all on public.push_notification_outbox from public,anon,authenticated,service_role;

create or replace function public.register_push_installation(
  p_installation_id text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  value text:=trim(coalesce(p_installation_id,''));
  row_id uuid;
  stamp timestamptz:=statement_timestamp();
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;
  if length(value) not between 16 and 512
     or value !~ '^[A-Za-z0-9_:\.-]+$' then
    raise exception 'Identificador de push inválido';
  end if;
  if not exists(select 1 from public.profiles where id=u) then
    raise exception 'Conta não inicializada';
  end if;

  insert into public.push_installations(
    user_id,installation_id,active,last_seen_at,disabled_at
  ) values (
    u,value,true,stamp,null
  )
  on conflict(installation_id) do update set
    user_id=excluded.user_id,
    active=true,
    last_seen_at=stamp,
    disabled_at=null
  returning id into row_id;

  insert into public.audit_logs(user_id,action)
  values(u,'push_installation_registered');

  return jsonb_build_object('outcome','registered','id',row_id);
end $$;

revoke all on function public.register_push_installation(text)
  from public,anon,authenticated;
grant execute on function public.register_push_installation(text)
  to authenticated;

create or replace function public.disable_push_installation(
  p_installation_id text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  value text:=trim(coalesce(p_installation_id,''));
  changed integer:=0;
  stamp timestamptz:=statement_timestamp();
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;

  update public.push_installations
  set active=false,disabled_at=stamp,last_seen_at=stamp
  where user_id=u and installation_id=value and active=true;
  get diagnostics changed=row_count;

  if changed>0 then
    insert into public.audit_logs(user_id,action)
    values(u,'push_installation_disabled');
  end if;

  return jsonb_build_object('outcome','disabled','changed',changed);
end $$;

revoke all on function public.disable_push_installation(text)
  from public,anon,authenticated;
grant execute on function public.disable_push_installation(text)
  to authenticated;

create or replace function public.update_push_preferences(
  p_routine_reminders boolean,
  p_refill_alerts boolean,
  p_operational_notices boolean,
  p_account_security_notices boolean
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;
  if p_routine_reminders is null
     or p_refill_alerts is null
     or p_operational_notices is null
     or p_account_security_notices is null then
    raise exception 'Preferências de push inválidas';
  end if;

  update public.settings
  set routine_reminders=p_routine_reminders,
      refill_alerts=p_refill_alerts,
      operational_notices=p_operational_notices,
      account_security_notices=p_account_security_notices,
      version=version+1,
      updated_at=stamp
  where user_id=u;

  if not found then raise exception 'Conta não inicializada'; end if;

  insert into public.audit_logs(user_id,action)
  values(u,'push_preferences_updated');

  return jsonb_build_object(
    'routine_reminders',p_routine_reminders,
    'refill_alerts',p_refill_alerts,
    'operational_notices',p_operational_notices,
    'account_security_notices',p_account_security_notices
  );
end $$;

revoke all on function public.update_push_preferences(boolean,boolean,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.update_push_preferences(boolean,boolean,boolean,boolean)
  to authenticated;

create or replace function public.enqueue_push_notification(
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
  stamp timestamptz:=statement_timestamp();
  queued integer:=0;
  preference_allowed boolean:=false;
begin
  if p_user_id is null or not exists(select 1 from public.profiles where id=p_user_id) then
    raise exception 'Conta de push inválida';
  end if;
  if p_event_type not in ('routine_due','refill_due','operational','account_security') then
    raise exception 'Evento de push inválido';
  end if;
  if p_dedupe_key is null or length(trim(p_dedupe_key)) not between 1 and 180 then
    raise exception 'Chave de deduplicação inválida';
  end if;

  select case p_event_type
    when 'routine_due' then s.routine_reminders
    when 'refill_due' then s.refill_alerts
    when 'account_security' then s.account_security_notices
    when 'operational' then s.operational_notices
    else false
  end into preference_allowed
  from public.settings s
  where s.user_id=p_user_id;

  if coalesce(preference_allowed,false) is not true then
    return jsonb_build_object('outcome','skipped_preference','queued',0);
  end if;

  insert into public.push_notification_outbox(
    user_id,push_installation_id,event_type,dedupe_key,available_at
  )
  select
    p_user_id,
    i.id,
    p_event_type,
    trim(p_dedupe_key)||':'||i.id::text,
    coalesce(p_available_at,stamp)
  from public.push_installations i
  where i.user_id=p_user_id and i.active=true
  on conflict(dedupe_key) do nothing;

  get diagnostics queued=row_count;

  return jsonb_build_object(
    'outcome',case when queued>0 then 'queued' else 'no_active_installation' end,
    'queued',queued
  );
end $$;

revoke all on function public.enqueue_push_notification(uuid,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.enqueue_push_notification(uuid,text,text,timestamptz)
  to service_role;

create or replace function public.claim_push_notification(
  p_worker_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  item public.push_notification_outbox;
  install public.push_installations;
  settings_row public.settings;
  stamp timestamptz:=statement_timestamp();
  allowed boolean:=false;
begin
  if p_worker_id is null then raise exception 'Worker inválido'; end if;

  select * into item
  from public.push_notification_outbox
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

  select * into install
  from public.push_installations
  where id=item.push_installation_id;

  select * into settings_row
  from public.settings
  where user_id=item.user_id;

  allowed:=case item.event_type
    when 'routine_due' then coalesce(settings_row.routine_reminders,false)
    when 'refill_due' then coalesce(settings_row.refill_alerts,false)
    when 'account_security' then coalesce(settings_row.account_security_notices,false)
    when 'operational' then coalesce(settings_row.operational_notices,false)
    else false
  end;

  if install.id is null or install.active is not true then
    update public.push_notification_outbox
    set status='skipped',last_error_code='INSTALLATION_INACTIVE',updated_at=stamp
    where id=item.id;
    return jsonb_build_object('outcome','skipped','reason','installation_inactive');
  end if;

  if allowed is not true then
    update public.push_notification_outbox
    set status='skipped',last_error_code='PREFERENCE_DISABLED',updated_at=stamp
    where id=item.id;
    return jsonb_build_object('outcome','skipped','reason','preference_disabled');
  end if;

  update public.push_notification_outbox
  set status='processing',
      attempts=attempts+1,
      locked_at=stamp,
      worker_id=p_worker_id,
      updated_at=stamp
  where id=item.id
  returning * into item;

  return jsonb_build_object(
    'outcome','claimed',
    'id',item.id,
    'event_type',item.event_type,
    'attempt',item.attempts,
    'installation_id',install.installation_id
  );
end $$;

revoke all on function public.claim_push_notification(uuid)
  from public,anon,authenticated;
grant execute on function public.claim_push_notification(uuid)
  to service_role;

create or replace function public.complete_push_notification(
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
  item public.push_notification_outbox;
  stamp timestamptz:=statement_timestamp();
  retry_seconds integer;
  final_status text;
begin
  if p_id is null or p_worker_id is null then
    raise exception 'Conclusão de push inválida';
  end if;
  if p_outcome not in ('sent','retry','dead') then
    raise exception 'Resultado de push inválido';
  end if;

  select * into item
  from public.push_notification_outbox
  where id=p_id
  for update;

  if item.id is null
     or item.status<>'processing'
     or item.worker_id is distinct from p_worker_id then
    raise exception 'Lock do push inválido';
  end if;

  if p_provider_message_id is not null and length(p_provider_message_id)>500 then
    raise exception 'ID do provedor inválido';
  end if;
  if p_error_code is not null and length(p_error_code)>100 then
    raise exception 'Código de erro inválido';
  end if;

  if p_outcome='sent' then
    update public.push_notification_outbox
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
    update public.push_notification_outbox
    set status='retry',
        available_at=stamp+(retry_seconds*interval '1 second'),
        last_error_code=coalesce(p_error_code,'RETRY'),
        worker_id=null,
        locked_at=null,
        updated_at=stamp
    where id=item.id;
    final_status:='retry';

  else
    update public.push_notification_outbox
    set status='dead',
        last_error_code=coalesce(p_error_code,'DELIVERY_FAILED'),
        worker_id=null,
        locked_at=null,
        updated_at=stamp
    where id=item.id;

    if p_error_code='FCM_UNREGISTERED' then
      update public.push_installations
      set active=false,disabled_at=stamp,last_seen_at=stamp
      where id=item.push_installation_id;
    end if;

    final_status:='dead';
  end if;

  return jsonb_build_object('outcome',final_status,'id',item.id);
end $$;

revoke all on function public.complete_push_notification(uuid,uuid,text,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.complete_push_notification(uuid,uuid,text,text,text,integer)
  to service_role;

commit;
