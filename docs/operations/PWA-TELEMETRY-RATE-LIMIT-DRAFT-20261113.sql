-- NON-EXECUTABLE DESIGN CANDIDATE / DO NOT APPLY TO TEST OR PROD.
-- This is intentionally in docs/operations, not supabase/migrations.
-- Create a real migration with the CURRENT Supabase CLI only after local QA,
-- protected TEST backup, release-scope review and environment authorization.
-- Policy thresholds are provisional (12 per installation / 240 global per hour).
-- Verify actual volume, load, concurrency and install UX before promotion.

begin;

-- The existing created_at DESC index covers the global rolling-hour count.
-- This new index is needed for a per-installation rolling-hour count.
create index if not exists pwa_install_events_installation_created_idx
  on public.pwa_install_events(installation_id,created_at desc);

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
  stamp timestamptz:=statement_timestamp();
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

  -- One transaction-scoped lock serializes check+insert for anonymous writes.
  -- Other callers do not wait: telemetry is noncritical, so it fails closed.
  -- Advisory lock namespace must be checked for collision before promotion.
  if not pg_catalog.pg_try_advisory_xact_lock(202611,13) then
    return pg_catalog.jsonb_build_object('recorded',false);
  end if;

  -- Preserve both unique constraints and idempotent client retries.
  if exists(select 1 from public.pwa_install_events e
     where e.event_id=p_event_id) then
    return pg_catalog.jsonb_build_object('recorded',false);
  end if;
  if p_event_type='installed' and exists(
    select 1 from public.pwa_install_events e
    where e.installation_id=p_installation_id and e.event_type='installed'
  ) then
    return pg_catalog.jsonb_build_object('recorded',false);
  end if;

  -- Global limit also caps clients that rotate untrusted installation UUIDs.
  -- It does NOT protect network/CPU from repeated rejected HTTP calls;
  -- add independent edge/WAF limits if available and permitted.
  if (select count(*) from public.pwa_install_events e
      where e.created_at>stamp-interval '1 hour')>=240 then
    return pg_catalog.jsonb_build_object('recorded',false);
  end if;
  if (select count(*) from public.pwa_install_events e
      where e.installation_id=p_installation_id
        and e.created_at>stamp-interval '1 hour')>=12 then
    return pg_catalog.jsonb_build_object('recorded',false);
  end if;

  insert into public.pwa_install_events(event_id,installation_id,event_type,platform)
  values(p_event_id,p_installation_id,p_event_type,p_platform)
  on conflict do nothing;
  get diagnostics inserted_count=row_count;
  return pg_catalog.jsonb_build_object('recorded',inserted_count=1);
end $$;

-- Preserve current public-anonymous design intentionally.
revoke all on function public.record_pwa_install_event(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.record_pwa_install_event(uuid,uuid,text,text)
  to anon,authenticated;

commit;
