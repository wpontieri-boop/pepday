import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('fundação de billing preserva os planos e preços aprovados', async () => {
  const req = await read('REQUISITOS.txt');
  assert.match(req,/PRO Mensal:\s*R\$ 14,90\/mês/);
  assert.match(req,/PRO Anual:\s*R\$ 99,90\/ano/);
  assert.match(req,/Tolerância após falha de renovação:\s*3 dias/);
});

test('ledger de billing é idempotente e backend-only', async () => {
  const sql = await read('supabase/migrations/20260928202253_block_c_billing_foundation.sql');
  assert.match(sql,/create table public\.billing_events/);
  assert.match(sql,/unique\(provider,event_type,provider_event_id\)/);
  assert.match(sql,/alter table public\.billing_events enable row level security/);
  assert.match(sql,/revoke all on public\.billing_events from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.apply_billing_event[^]*to service_role/);
  assert.doesNotMatch(sql,/grant execute on function public\.apply_billing_event[^]*to authenticated/);
});

test('motor de billing cobre aprovação, rejeição, renovação, cancelamento, expiração e reativação', async () => {
  const sql = await read('supabase/migrations/20260928202253_block_c_billing_foundation.sql');
  for (const effect of [
    'payment_approved','payment_pending','payment_rejected','renewal_failed',
    'subscription_canceled','subscription_reactivated','subscription_paused','subscription_expired'
  ]) assert.match(sql,new RegExp(effect));
  assert.match(sql,/p_provider_event_at\+interval '3 days'/);
  assert.match(sql,/cancel_at_period_end=true/);
  assert.match(sql,/status='pro_expired'/);
  assert.match(sql,/last_provider_event_at is not null and p_provider_event_at<s\.last_provider_event_at/);
});

test('pagamento aprovado exige período e plano válidos e não confia no frontend', async () => {
  const sql = await read('supabase/migrations/20260928202253_block_c_billing_foundation.sql');
  assert.match(sql,/p_plan not in \('monthly','annual'\)/);
  assert.match(sql,/p_period_start is null or p_period_end is null or p_period_end<=p_period_start/);
  assert.match(sql,/provider='mercado_pago'/);
  assert.match(sql,/security definer set search_path=''/);
});

test('ledger não armazena payload bruto do provedor', async () => {
  const sql = await read('supabase/migrations/20260928202253_block_c_billing_foundation.sql');
  const table = sql.slice(sql.indexOf('create table public.billing_events'),sql.indexOf('alter table public.billing_events'));
  assert.doesNotMatch(table,/payload\s+jsonb/i);
  assert.doesNotMatch(table,/payer_email|card_token|access_token/i);
});

test('pagamento aprovado que estende o período vence ordem de webhook do preapproval', async () => {
  const sql = await read('supabase/migrations/20260929220835_fix_billing_approved_payment_order.sql');
  assert.match(sql,/if p_effect='payment_approved' then/);
  assert.match(sql,/p_period_end<=s\.current_period_end/);
  assert.match(sql,/elsif s\.last_provider_event_at is not null and p_provider_event_at<s\.last_provider_event_at/);
});
