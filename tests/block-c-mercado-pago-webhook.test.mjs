import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  canonicalEventDate,
  effectFromAuthorizedPayment,
  effectFromPreapproval,
  normalizeNotification,
  paidPeriod,
  parsePepDayReference,
  planFromCanonicalSubscription,
  signatureManifest,
  verifyMercadoPagoSignature,
} from '../supabase/functions/mercado-pago-webhook/webhook-core.mjs';

test('manifesto HMAC segue o formato oficial e normaliza data.id para minúsculo',()=>{
  assert.equal(
    signatureManifest({dataId:'ABC123',requestId:'req-1',ts:'1742505638683'}),
    'id:abc123;request-id:req-1;ts:1742505638683;'
  );
  assert.equal(signatureManifest({dataId:'ABC'}),'id:abc;');
});

test('assinatura Mercado Pago aceita HMAC correto e rejeita assinatura alterada',async()=>{
  const secret='segredo-de-teste-local';
  const dataId='INV123',requestId='req-xyz',ts='1742505638683';
  const manifest=signatureManifest({dataId,requestId,ts});
  const hash=createHmac('sha256',secret).update(manifest).digest('hex');
  assert.equal(await verifyMercadoPagoSignature({
    secret,xSignature:`ts=${ts},v1=${hash}`,xRequestId:requestId,dataId
  }),true);
  assert.equal(await verifyMercadoPagoSignature({
    secret,xSignature:`ts=${ts},v1=${'0'.repeat(64)}`,xRequestId:requestId,dataId
  }),false);
});

test('notificação aceita tópicos canônicos de assinatura/pagamento e exige correspondência do data.id',()=>{
  const body={id:123,type:'subscription_authorized_payment',action:'updated',live_mode:false,data:{id:'ABC'}};
  const good=normalizeNotification(body,new URL('https://example.test/hook?data.id=ABC'));
  assert.deepEqual(good,{eventId:'123',type:'subscription_authorized_payment',action:'updated',dataId:'ABC',liveMode:false});
  assert.deepEqual(
    normalizeNotification({...body,type:'payment',action:'payment.updated'},new URL('https://example.test/hook?data.id=ABC')),
    {eventId:'123',type:'payment',action:'payment.updated',dataId:'ABC',liveMode:false}
  );
  assert.equal(normalizeNotification(body,new URL('https://example.test/hook?data.id=OUTRO')),null);
  assert.equal(normalizeNotification({...body,type:'merchant_order'},new URL('https://example.test/hook?data.id=ABC')),null);
});

test('external_reference mapeia somente referência PepDay válida',()=>{
  const id=randomUUID();
  assert.deepEqual(parsePepDayReference(`pepday:${id}:annual`),{subscriptionId:id,plan:'annual'});
  assert.deepEqual(parsePepDayReference(`pepday:${id}`),{subscriptionId:id,plan:null});
  assert.equal(parsePepDayReference('outro:123'),null);
});

test('plano vem do plan id canônico e referência PepDay é fallback controlado',()=>{
  const id=randomUUID();
  assert.equal(planFromCanonicalSubscription(
    {preapproval_plan_id:'mp-monthly',external_reference:`pepday:${id}:annual`},
    {monthlyPlanId:'mp-monthly',annualPlanId:'mp-annual'}
  ),'monthly');
  assert.equal(planFromCanonicalSubscription(
    {preapproval_plan_id:'desconhecido',external_reference:`pepday:${id}:annual`},
    {monthlyPlanId:'mp-monthly',annualPlanId:'mp-annual'}
  ),'annual');
});

test('período pago exige debit_date anterior ao next_payment_date',()=>{
  assert.deepEqual(paidPeriod(
    {debit_date:'2026-09-28T12:00:00Z'},
    {next_payment_date:'2026-10-28T12:00:00Z'}
  ),{start:'2026-09-28T12:00:00.000Z',end:'2026-10-28T12:00:00.000Z'});
  assert.equal(paidPeriod(
    {debit_date:'2026-10-28T12:00:00Z'},
    {next_payment_date:'2026-09-28T12:00:00Z'}
  ),null);
});

test('fatura aprovada concede efeito pago; rejeição diferencia compra inicial e renovação',()=>{
  assert.equal(effectFromAuthorizedPayment({payment:{status:'approved'}},{started_at:null,plan:'free'}),'payment_approved');
  assert.equal(effectFromAuthorizedPayment({payment:{status:'rejected'}},{started_at:null,plan:'free'}),'payment_rejected');
  assert.equal(effectFromAuthorizedPayment({payment:{status:'rejected'}},{started_at:'2026-08-01T00:00:00Z',plan:'monthly'}),'renewal_failed');
  assert.equal(effectFromAuthorizedPayment({payment:{status:'pending'}},{}),'payment_pending');
});

test('preapproval não libera PRO por status authorized de assinatura nova',()=>{
  assert.equal(effectFromPreapproval({status:'authorized'},{cancel_at_period_end:false,provider_status:null}),null);
  assert.equal(effectFromPreapproval({status:'authorized'},{cancel_at_period_end:true,provider_status:'canceled'}),'subscription_reactivated');
  assert.equal(effectFromPreapproval({status:'canceled'},{}),'subscription_canceled');
  assert.equal(effectFromPreapproval({status:'paused'},{}),'subscription_paused');
});

test('data do evento usa fonte canônica disponível e recusa ausência',()=>{
  assert.equal(canonicalEventDate({date_created:'2026-09-28T10:00:00Z'},{}),'2026-09-28T10:00:00.000Z');
  assert.equal(canonicalEventDate({}, {last_modified:'2026-09-28T11:00:00Z'}),'2026-09-28T11:00:00.000Z');
  assert.equal(canonicalEventDate({},{}),null);
});

test('Edge Function valida assinatura antes do corpo e consulta Mercado Pago antes do RPC',async()=>{
  const [index,config]=await Promise.all([
    readFile(new URL('../supabase/functions/mercado-pago-webhook/index.mjs',import.meta.url),'utf8'),
    readFile(new URL('../supabase/config.toml',import.meta.url),'utf8')
  ]);
  assert.ok(index.indexOf('verifyMercadoPagoSignature')<index.indexOf('req.json()'));
  assert.match(index,/\/authorized_payments\//);
  assert.match(index,/\/preapproval\//);
  assert.match(index,/ACKNOWLEDGED_PAYMENT_MIRROR/);
  assert.ok(index.indexOf('ACKNOWLEDGED_PAYMENT_MIRROR')<index.indexOf('const result=await applyBillingEvent'));
  assert.ok(index.indexOf('mercadoPagoGet')<index.indexOf('const result=await applyBillingEvent'));
  assert.match(index,/\/rest\/v1\/rpc\/apply_billing_event/);
  assert.match(index,/SUPABASE_SECRET_KEYS/);
  assert.doesNotMatch(index,/MERCADO_PAGO_ACCESS_TOKEN[^\n]*console|MERCADO_PAGO_WEBHOOK_SECRET[^\n]*console/);
  assert.match(config,/\[functions\.mercado-pago-webhook\][^]*verify_jwt = false[^]*entrypoint = "\.\/functions\/mercado-pago-webhook\/index\.mjs"/);
});
