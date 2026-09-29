-- PepDay V3.0 / Bloco C — índices dos FKs de códigos promocionais.
begin;

create index promo_codes_exclusive_user_idx
  on public.promo_codes(exclusive_user_id)
  where exclusive_user_id is not null;

create index promo_codes_created_by_idx
  on public.promo_codes(created_by)
  where created_by is not null;

commit;
