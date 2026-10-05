begin;
alter table public.recovery_campaigns add column checkout_started_at timestamptz;
alter table public.recovery_campaigns add column provider_checked_at timestamptz;
create function public.mark_recovery_provider_checked(p_campaign_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin update public.recovery_campaigns set provider_checked_at=statement_timestamp() where id=p_campaign_id;end $$;
create function public.claim_recovery_checkout(p_campaign_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.recovery_campaigns set checkout_started_at=statement_timestamp()
    where id=p_campaign_id and checkout_started_at is null and checkout_request_id is not null
      and provider_subscription_id is null and status='active' and offer_expires_at>statement_timestamp()
      and public.recovery_candidate(user_id) is not null;
  return found;
end $$;
create function public.recover_recovery_checkout(p_campaign_id uuid,p_provider_id text,p_url text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if length(p_provider_id) not between 1 and 200 or p_url !~ '^https://([a-z0-9-]+[.])*mercadopago[.]com([.]br)?/' then raise exception 'Checkout inválido';end if;
  -- Somente após consulta canônica pelo worker, incluindo intent expirado a cancelar.
  update public.recovery_campaigns set provider_subscription_id=p_provider_id,checkout_url=p_url
    where id=p_campaign_id and checkout_started_at is not null and provider_subscription_id is null;
end $$;
create or replace function public.recovery_provider_state() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('config',(select to_jsonb(cfg) from public.recovery_config cfg),
    'pending',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('subscription_id',s.id) order by c.provider_checked_at nulls first)
      from public.recovery_campaigns c join public.subscriptions s on s.user_id=c.user_id
      where (c.provider_subscription_id is not null and c.price_reset_at is null)
        or (c.provider_subscription_id is null and c.checkout_started_at is not null)
        or (c.status='converted' and c.provider_subscription_id is not null
          and (c.provider_checked_at is null or c.provider_checked_at<statement_timestamp()-interval '1 day'))),'[]'::jsonb));
$$;
revoke all on function public.claim_recovery_checkout(uuid),public.recover_recovery_checkout(uuid,text,text),public.recovery_provider_state() from public,anon,authenticated;
grant execute on function public.claim_recovery_checkout(uuid),public.recover_recovery_checkout(uuid,text,text),public.recovery_provider_state() to service_role;
revoke all on function public.mark_recovery_provider_checked(uuid) from public,anon,authenticated;
grant execute on function public.mark_recovery_provider_checked(uuid) to service_role;
commit;
