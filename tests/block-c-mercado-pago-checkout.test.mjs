import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  PLANS,
  canCreateCheckout,
  checkoutExternalReference,
  checkoutRecurring,
  normalizeCheckoutRequest,
  validCheckoutUrl,
} from '../supabase/functions/mercado-pago-checkout/checkout-core.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('planos comerciais mantêm preços aprovados',()=>{
  assert.equal(PLANS.monthly.price,14.90);
  assert.equal(PLANS.annual.price,99.90);
});

test('checkout aceita somente plano conhecido e request_id UUID v4',()=>{
  const requestId=randomUUID();
  assert.deepEqual(normalizeCheckoutRequest({plan:'monthly',request_id:requestId}),{plan:'monthly',requestId});
  assert.equal(normalizeCheckoutRequest({plan:'vip',request_id:requestId}),null);
  assert.equal(normalizeCheckoutRequest({plan:'annual',request_id:'123'}),null);
});

test('external_reference não aceita IDs arbitrários e inclui plano',()=>{
  const subscriptionId=randomUUID();
  assert.equal(checkoutExternalReference(subscriptionId,'annual'),`pepday:${subscriptionId}:annual`);
  assert.equal(checkoutExternalReference('x','annual'),null);
  assert.equal(checkoutExternalReference(subscriptionId,'vip'),null);
});

test('recorrência do checkout vem somente dos planos comerciais aprovados',()=>{
  assert.deepEqual(checkoutRecurring('monthly'),{
    frequency:1,frequency_type:'months',transaction_amount:14.90,currency_id:'BRL'
  });
  assert.deepEqual(checkoutRecurring('annual'),{
    frequency:12,frequency_type:'months',transaction_amount:99.90,currency_id:'BRL'
  });
  assert.equal(checkoutRecurring('vip'),null);
});

test('checkout URL aceita somente HTTPS do domínio Mercado Pago',()=>{
  assert.equal(validCheckoutUrl('https://www.mercadopago.com.br/subscriptions/checkout?id=1'),true);
  assert.equal(validCheckoutUrl('https://mercadopago.com/subscriptions/checkout?id=1'),true);
  assert.equal(validCheckoutUrl('http://www.mercadopago.com.br/x'),false);
  assert.equal(validCheckoutUrl('https://mercadopago.com.br.evil.example/x'),false);
});

test('assinatura paga ativa não abre nova assinatura paralela',()=>{
  assert.equal(canCreateCheckout({status:'pro_active',provider_subscription_id:'abc'}),false);
  assert.equal(canCreateCheckout({status:'pro_expired',provider_subscription_id:'abc'}),true);
  assert.equal(canCreateCheckout({status:'trial',provider_subscription_id:null}),true);
});

test('Edge Function responde preflight CORS antes do checkout',async()=>{
  const index=await read('supabase/functions/mercado-pago-checkout/index.mjs');
  assert.match(index,/Access-Control-Allow-Origin/);
  assert.match(index,/Access-Control-Allow-Methods[^\n]*POST, OPTIONS/);
  assert.match(index,/Access-Control-Allow-Headers[^\n]*authorization/);
  assert.match(index,/req\.method===\"OPTIONS\"/);
  assert.match(index,/status:204/);
});

test('Edge Function valida JWT e cria assinatura pending sem coletar cartão no PepDay',async()=>{
  const index=await read('supabase/functions/mercado-pago-checkout/index.mjs');
  assert.ok(index.indexOf('authenticatedUser')<index.indexOf('"https://api.mercadopago.com/preapproval"'));
  assert.match(index,/\/auth\/v1\/user/);
  assert.match(index,/MERCADO_PAGO_LIVE_MODE/);
  assert.match(index,/MERCADO_PAGO_TEST_PAYER_EMAIL/);
  assert.match(index,/MP_TEST_PAYER_EMAIL_MISSING/);
  assert.doesNotMatch(index,/test@testuser\.com/);
  assert.match(index,/payer_email:payerEmail/);
  assert.match(index,/external_reference:externalReference/);
  assert.match(index,/auto_recurring:recurring/);
  assert.match(index,/status:\"pending\"/);
  assert.match(index,/"X-Idempotency-Key":request\.requestId/);
  assert.match(index,/PEPDAY_BILLING_RETURN_URL/);
  assert.doesNotMatch(index,/card_token_id/);
  assert.doesNotMatch(index,/preapproval_plan_id:/);
});

test('erro do provedor é logado de forma sanitizada e limitada',async()=>{
  const index=await read('supabase/functions/mercado-pago-checkout/index.mjs');
  assert.match(index,/safeProviderError/);
  assert.match(index,/PepDay Mercado Pago provider:/);
  assert.match(index,/\[email\]/);
  assert.match(index,/\[credential\]/);
  assert.match(index,/\.slice\(0,240\)/);
  assert.doesNotMatch(index,/JSON\.stringify\(data\)/);
});

test('checkout não grava entitlement nem status de assinatura antes do webhook',async()=>{
  const index=await read('supabase/functions/mercado-pago-checkout/index.mjs');
  assert.doesNotMatch(index,/update\s+public\.subscriptions/i);
  assert.doesNotMatch(index,/status\s*:\s*['"]pro_active['"]/i);
  assert.doesNotMatch(index,/\/rest\/v1\/rpc\/apply_billing_event/);
  assert.match(index,/checkout_url:checkout\.init_point/);
});

test('tela comercial exibe mensal, anual e preservação de dados',async()=>{
  const html=await read('index.html');
  assert.match(html,/id="proOffer"/);
  assert.match(html,/Escolha seu PepDay PRO/);
  assert.match(html,/R\$ 14,90/);
  assert.match(html,/R\$ 99,90/);
  assert.match(html,/Economize R\$ 78,90 por ano/);
  assert.match(html,/Seus dados permanecem salvos mesmo se o teste ou a assinatura terminar/);
});

test('UI chama somente Edge Function autenticada e valida URL antes de redirecionar',async()=>{
  const account=await read('src/account-ui.mjs');
  assert.match(account,/functions\.invoke\('mercado-pago-checkout'/);
  assert.match(account,/request_id:crypto\.randomUUID\(\)/);
  assert.match(account,/safeCheckoutUrl\(data\?\.checkout_url\)/);
  assert.match(account,/location\.assign\(checkoutUrl\)/);
  assert.doesNotMatch(account,/subscriptions[^\n]*update/i);
});

test('PRO expirado oferece caminho explícito para os planos',async()=>{
  const gate=await read('src/pro-gate.mjs');
  assert.match(gate,/commercial \? 'Ver planos'/);
  assert.match(gate,/decision\.reason==='expired'[^]*proOffer/);
});

test('configuração das duas Edge Functions não delega autorização ao frontend',async()=>{
  const config=await read('supabase/config.toml');
  assert.match(config,/\[functions\.mercado-pago-webhook\][^]*verify_jwt = false/);
  assert.match(config,/\[functions\.mercado-pago-checkout\][^]*verify_jwt = false[^]*mercado-pago-checkout\/index\.mjs/);
});
