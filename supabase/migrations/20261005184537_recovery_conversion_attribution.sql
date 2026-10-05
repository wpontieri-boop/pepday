begin;
create or replace function public.stop_recovery_sequence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='subscriptions' and to_jsonb(new)->>'status'='pro_active'
    and to_jsonb(new)->>'provider'='mercado_pago' and to_jsonb(new)->>'last_payment_status'='approved' then
    -- Janela conservadora: envio confirmado da campanha nos 7 dias anteriores.
    -- Não atribui compras só porque a conta foi selecionada ou uma mensagem foi enfileirada.
    update public.recovery_campaigns c set status='converted',converted_at=statement_timestamp(),stop_reason='PAID_AFTER_CAMPAIGN'
      where c.user_id=new.user_id and c.converted_at is null
      and (c.status='active' or (c.status='stopped' and c.stop_reason='SUBSCRIPTION_AUTHORIZED'))
      and exists(select 1 from public.recovery_email_outbox o where o.campaign_id=c.id and o.status='sent'
        and o.sent_at between statement_timestamp()-interval '7 days' and statement_timestamp());
  end if;
  if (tg_table_name='settings' and (to_jsonb(new)->>'marketing_opt_in')::boolean is not true)
    or (tg_table_name='subscriptions' and to_jsonb(new)->>'status'='pro_active') then
    update public.recovery_campaigns set status='stopped',stop_reason=case when tg_table_name='settings' then 'CONSENT_REVOKED' else 'SUBSCRIBED' end
      where user_id=new.user_id and status='active';
    update public.recovery_email_outbox o set status='suppressed',worker_id=null,error_code='SEQUENCE_STOPPED'
      from public.recovery_campaigns c where c.id=o.campaign_id and c.user_id=new.user_id and o.status in ('pending','retry','processing');
  end if;
  return new;
end $$;
revoke all on function public.stop_recovery_sequence() from public,anon,authenticated,service_role;
commit;
