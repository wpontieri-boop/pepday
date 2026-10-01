-- PepDay V3.0 — telemetria mínima da instalação PWA.
-- Não armazena e-mail, nome, rotina, frasco, conteúdo clínico ou user-agent bruto.
begin;

create table if not exists public.pwa_install_events (
  event_id uuid primary key,
  installation_id uuid not null,
  event_type text not null check (event_type in ('installed','standalone_launch')),
  platform text not null check (platform in ('ios','android','desktop','other')),
  created_at timestamptz not null default statement_timestamp()
);

alter table public.pwa_install_events enable row level security;

revoke all on table public.pwa_install_events
  from public,anon,authenticated;

create index if not exists pwa_install_events_created_idx
  on public.pwa_install_events(created_at desc);

create index if not exists pwa_install_events_type_created_idx
  on public.pwa_install_events(event_type,created_at desc);

create unique index if not exists pwa_install_events_installed_once_idx
  on public.pwa_install_events(installation_id)
  where event_type='installed';
create or replace function public.record_pwa_install_event(
  p_installation_id uuid,
  p_event_id uuid,
  p_event_type text,
  p_platform text
) returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  inserted_count integer:=0;
begin
  if p_installation_id is null or p_event_id is null then
    raise exception 'Evento PWA inválido';
  end if;

  if p_event_type not in ('installed','standalone_launch') then
    raise exception 'Tipo de evento PWA inválido';
  end if;

  if p_platform not in ('ios','android','desktop','other') then
    raise exception 'Plataforma PWA inválida';
  end if;

  insert into public.pwa_install_events(event_id,installation_id,event_type,platform)
  values(p_event_id,p_installation_id,p_event_type,p_platform)
  on conflict do nothing;

  get diagnostics inserted_count=row_count;
  return jsonb_build_object(
    'recorded',inserted_count=1
  );
end $$;

revoke all on function public.record_pwa_install_event(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.record_pwa_install_event(uuid,uuid,text,text)
  to anon,authenticated;

create or replace function public.get_admin_pwa_metrics(
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
  window_start timestamptz;
  detected_installs bigint:=0;
  active_installed_devices bigint:=0;
  standalone_launches bigint:=0;
begin
  if u is null then
    raise exception 'Autenticação necessária' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=u and role='admin'
  ) then
    raise exception 'Acesso administrativo necessário' using errcode='42501';
  end if;

  if p_days is null or p_days not in (7,30,90) then
    raise exception 'Janela administrativa inválida';
  end if;

  window_start:=stamp-(p_days*interval '1 day');

  select count(*) into detected_installs
  from (
    select e.installation_id
    from public.pwa_install_events e
    group by e.installation_id
    having min(e.created_at)>=window_start
       and min(e.created_at)<=stamp
  ) first_seen;

  select count(distinct e.installation_id)
    into active_installed_devices
  from public.pwa_install_events e
  where e.event_type='standalone_launch'
    and e.created_at>=window_start
    and e.created_at<=stamp;
  select count(*) into standalone_launches
  from public.pwa_install_events e
  where e.event_type='standalone_launch'
    and e.created_at>=window_start
    and e.created_at<=stamp;

  return jsonb_build_object(
    'generated_at',stamp,
    'window_days',p_days,
    'window_start',window_start,
    'detected_installs',detected_installs,
    'active_installed_devices',active_installed_devices,
    'standalone_launches',standalone_launches,
    'definitions',jsonb_build_object(
      'detected_installs','Dispositivos cuja primeira evidência de instalação ocorreu na janela.',
      'active_installed_devices','Dispositivos instalados que abriram o PepDay em modo standalone na janela.',
      'standalone_launches','Aberturas do PWA instalado registradas uma vez por sessão.'
    )
  );
end $$;

revoke all on function public.get_admin_pwa_metrics(integer)
  from public,anon,authenticated;
grant execute on function public.get_admin_pwa_metrics(integer)
  to authenticated;

commit;
