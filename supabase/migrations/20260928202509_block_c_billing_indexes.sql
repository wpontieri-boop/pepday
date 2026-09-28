-- PepDay V3.0 / Bloco C — índice do ledger de billing.
begin;

create index billing_events_subscription_received_idx
  on public.billing_events(subscription_id, received_at desc);

commit;
