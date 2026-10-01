import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cancellationConfirmed,
  cancellationState,
  mercadoPagoCancelBody,
  normalizeCancelRequest,
  validProviderSubscriptionId,
} from '../supabase/functions/mercado-pago-cancel-subscription/cancel-core.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('pedido de cancelamento exige confirmação exata',()=>{
  assert.deepEqual(normalizeCancelRequest({confirm:'CANCELAR'}),{confirm:'CANCELAR'});
  for(const value of [null,{},[],{confirm:'cancelar'},{confirm:' CANCELAR '},{confirm:true}]) {
    assert.equal(normalizeCancelRequest(value),null);
  }
});

test('estado de cancelamento só aceita assinatura Mercado Pago vigente',()=>{
  assert.equal(cancellationState(null),'not_applicable');
  assert.equal(cancellationState({provider:'stripe',provider_subscription_id:'sub-12345678'}),'not_applicable');
  assert.equal(cancellationState({provider:'mercado_pago',provider_subscription_id:'sub-12345678',billing_status:'active',provider_status:'authorized'}),'cancel');
  assert.equal(cancellationState({provider:'mercado_pago',provider_subscription_id:'sub-12345678',billing_status:'canceled',provider_status:'canceled'}),'already_canceled');
  assert.equal(cancellationState({provider:'mercado_pago',provider_subscription_id:'sub-12345678',billing_status:'expired'}),'not_applicable');
});

test('corpo do provedor cancela somente a recorrência canônica',()=>{
  assert.deepEqual(mercadoPagoCancelBody(),{status:'canceled'});
  assert.equal(validProviderSubscriptionId('2c938084726fca480172750000000000'),'2c938084726fca480172750000000000');
  assert.equal(validProviderSubscriptionId('../bad'),null);
  assert.equal(cancellationConfirmed({id:'abc123456',status:'canceled'},'abc123456'),true);
  assert.equal(cancellationConfirmed({id:'abc123456',status:'authorized'},'abc123456'),false);
});

test('Edge Function autentica o usuário antes de cancelar no Mercado Pago',async()=>{
  const source=await read('supabase/functions/mercado-pago-cancel-subscription/index.mjs');
  const auth=source.indexOf('authenticatedUser(');
  const lookup=source.indexOf('subscriptionForUser(');
  const cancel=source.indexOf('cancelMercadoPago(');
  assert.ok(auth>=0&&lookup>auth&&cancel>lookup);
  assert.match(source,/https:\/\/api\.mercadopago\.com\/preapproval\//);
  assert.match(source,/method:"PUT"/);
  assert.match(source,/SUBSCRIPTION_CANCELED/);
  assert.doesNotMatch(source,/update\s+public\.subscriptions/i);
});

test('cancelamento responde CORS e não registra dados privados em logs',async()=>{
  const source=await read('supabase/functions/mercado-pago-cancel-subscription/index.mjs');
  assert.match(source,/Access-Control-Allow-Origin/);
  assert.match(source,/Access-Control-Allow-Methods[^\n]*POST, OPTIONS/);
  assert.ok(source.indexOf('req.method==="OPTIONS"')<source.indexOf('req.method!=="POST"'));
  const logs=[...source.matchAll(/console\.(?:log|error|warn)\(([^\n]+)\)/g)].map(m=>m[1]).join('\n');
  assert.doesNotMatch(logs,/email|token|authorization|provider_subscription_id|user\.id/i);
});

test('config e Perfil expõem gestão normal da assinatura',async()=>{
  const [config,html,ui]=await Promise.all([
    read('supabase/config.toml'),
    read('index.html'),
    read('src/account-ui.mjs')
  ]);
  assert.match(config,/\[functions\.mercado-pago-cancel-subscription\][^]*verify_jwt = false/);
  assert.match(html,/id="billingManagement"/);
  assert.match(html,/id="accountCancelSubscription"/);
  assert.match(html,/renovação automática/i);
  assert.match(ui,/window\.confirm\('Cancelar a renovação automática do PepDay PRO\?/);
  assert.ok(ui.indexOf('window.confirm')<ui.indexOf("functions.invoke('mercado-pago-cancel-subscription'"));
  assert.match(ui,/functions\.invoke\('mercado-pago-cancel-subscription'/);
  assert.match(ui,/Renovação cancelada no Mercado Pago/i);
});
