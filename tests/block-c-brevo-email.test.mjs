import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EMAIL_EVENTS,
  brevoParams,
  deliveryDecision,
  normalizeClaim,
  parseTemplateId,
  templateEnvName,
  validBrevoMessageId,
} from '../supabase/functions/brevo-email-worker/email-core.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const id='123e4567-e89b-42d3-a456-426614174000';

test('eventos transacionais cobrem o escopo Brevo aprovado',()=>{
  for(const event of [
    'account_created','trial_started','trial_ending','trial_ended',
    'payment_approved','renewal_approved','payment_failed','grace_ended',
    'subscription_canceled','subscription_reactivated','account_security'
  ]) assert.ok(EMAIL_EVENTS.includes(event));
});

test('templates são escolhidos somente por evento conhecido e env server-side',()=>{
  assert.equal(templateEnvName('trial_started'),'BREVO_TEMPLATE_TRIAL_STARTED');
  assert.equal(templateEnvName('vip_offer'),null);
  assert.equal(parseTemplateId('123'),123);
  assert.equal(parseTemplateId('0'),null);
  assert.equal(parseTemplateId('abc'),null);
});

test('claim normalizado rejeita conteúdo inesperado e valida destinatário',()=>{
  const claim=normalizeClaim({
    outcome:'claimed',id,event_type:'trial_started',attempt:1,
    recipient:{email:'user@example.com',name:'Pessoa'},
    context:{trial_end:'2026-10-01T12:00:00Z'}
  });
  assert.equal(claim.id,id);
  assert.equal(claim.recipient.email,'user@example.com');
  assert.equal(claim.eventType,'trial_started');
  assert.equal(normalizeClaim({...claim,event_type:'unknown'}),null);
  assert.equal(normalizeClaim({outcome:'claimed',id,event_type:'trial_started',attempt:1,recipient:{email:'x'}}),null);
});

test('params Brevo são restritos a contexto comercial não sensível',()=>{
  const params=brevoParams({
    recipient:{name:'Pessoa'},
    context:{plan:'annual',subscription_status:'pro_active',billing_status:'active',
      period_end:'2026-10-01',grace_until:'',trial_end:''}
  },'https://pepday.example/');
  assert.deepEqual(Object.keys(params).sort(),[
    'app_url','billing_status','grace_until','name','period_end','plan','subscription_status','trial_end'
  ]);
  assert.doesNotMatch(JSON.stringify(params),/routine|vial|dose|health|peptide/i);
});

test('Brevo 201 envia; transitórios repetem com backoff; permanentes encerram',()=>{
  assert.deepEqual(deliveryDecision(201,1),{outcome:'sent',retryAfterSeconds:null});
  assert.deepEqual(deliveryDecision(429,1),{outcome:'retry',retryAfterSeconds:60});
  assert.deepEqual(deliveryDecision(503,3),{outcome:'retry',retryAfterSeconds:240});
  assert.deepEqual(deliveryDecision(503,5),{outcome:'dead',retryAfterSeconds:null});
  assert.deepEqual(deliveryDecision(400,1),{outcome:'dead',retryAfterSeconds:null});
});

test('messageId do provedor é validado antes de persistir',()=>{
  assert.equal(validBrevoMessageId('abc-123'),'abc-123');
  assert.equal(validBrevoMessageId(''),null);
  assert.equal(validBrevoMessageId('x'.repeat(301)),null);
});

test('migration mantém outbox backend-only, idempotente e sem coluna de e-mail',async()=>{
  const sql=await read('supabase/migrations/20260928220752_block_c_brevo_email_outbox.sql');
  assert.match(sql,/dedupe_key text not null unique/);
  assert.match(sql,/for update skip locked/i);
  assert.match(sql,/attempts<5/);
  assert.match(sql,/revoke all on public\.transactional_email_outbox from public,anon,authenticated,service_role/);
  assert.match(sql,/grant execute on function public\.enqueue_transactional_email[^]*to service_role/i);
  assert.match(sql,/grant execute on function public\.claim_transactional_email[^]*to service_role/i);
  assert.match(sql,/grant execute on function public\.complete_transactional_email[^]*to service_role/i);
  const table=sql.match(/create table public\.transactional_email_outbox \(([^]*?)\n\);/i)?.[1]||'';
  assert.doesNotMatch(table,/\bemail\b|\bname\b|routine|vial|dose|health/i);
});

test('worker exige segredo interno antes de reivindicar outbox e usa endpoint Brevo fixo',async()=>{
  const source=await read('supabase/functions/brevo-email-worker/index.mjs');
  const secretCheck=source.indexOf('internalSecretOk(req)');
  const claimCall=source.indexOf('"claim_transactional_email"');
  assert.ok(secretCheck>=0&&claimCall>secretCheck);
  assert.match(source,/https:\/\/api\.brevo\.com\/v3\/smtp\/email/);
  assert.match(source,/"api-key":apiKey/);
  assert.match(source,/PEPDAY_EMAIL_WORKER_SECRET/);
  assert.match(source,/BREVO_API_KEY/);
  assert.match(source,/TEMPLATE_NOT_CONFIGURED/);
});

test('worker não loga destinatário, payload Brevo ou segredos',async()=>{
  const source=await read('supabase/functions/brevo-email-worker/index.mjs');
  const logs=[...source.matchAll(/console\.(?:log|error|warn)\(([^\n]+)\)/g)].map(match=>match[1]).join('\n');
  assert.doesNotMatch(logs,/recipient|email|apiKey|BREVO_API_KEY|body|data/i);
  assert.doesNotMatch(source,/console\.log/);
});

test('configuração declara worker sem JWT público e com autenticação própria documentada',async()=>{
  const config=await read('supabase/config.toml');
  assert.match(config,/\[functions\.brevo-email-worker\][^]*verify_jwt = false[^]*brevo-email-worker\/index\.mjs/);
  assert.match(config,/autenticação por segredo próprio/i);
});
