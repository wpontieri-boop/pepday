-- PepDay V3.0 / Bloco C — atribuição first-touch do cartão/QR.
-- Atribuição mede origem; ela NÃO concede desconto nem PRO por si só.
begin;

create table public.acquisition_attributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  source text not null check (source='card'),
  medium text not null check (medium='qr'),
  campaign text not null check (campaign='cartao-v1'),
  landing_path text not null check (landing_path='/cartao/'),
  first_seen_at timestamptz not null,
  attributed_at timestamptz not null default statement_timestamp()
);

create index acquisition_attributions_campaign_idx
  on public.acquisition_attributions(campaign,attributed_at desc);

alter table public.acquisition_attributions enable row level security;
revoke all on public.acquisition_attributions from public,anon,authenticated;

create or replace function public.claim_card_acquisition(
  p_first_seen_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid();
  stamp timestamptz:=statement_timestamp();
  seen timestamptz;
  a public.acquisition_attributions;
begin
  if u is null then raise exception 'Autenticação necessária'; end if;
  if not exists(select 1 from public.profiles where id=u) then
    raise exception 'Conta não inicializada';
  end if;

  seen:=coalesce(p_first_seen_at,stamp);
  if seen>stamp+interval '5 minutes' or seen<stamp-interval '90 days' then
    seen:=stamp;
  end if;

  insert into public.acquisition_attributions(
    user_id,source,medium,campaign,landing_path,first_seen_at
  ) values (
    u,'card','qr','cartao-v1','/cartao/',seen
  )
  on conflict(user_id) do nothing;

  select * into a from public.acquisition_attributions where user_id=u;
  return jsonb_build_object(
    'source',a.source,
    'medium',a.medium,
    'campaign',a.campaign,
    'landing_path',a.landing_path,
    'first_seen_at',a.first_seen_at,
    'attributed_at',a.attributed_at
  );
end $$;

revoke all on function public.claim_card_acquisition(timestamptz) from public,anon,authenticated;
grant execute on function public.claim_card_acquisition(timestamptz) to authenticated;

commit;
