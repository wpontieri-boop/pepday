import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PUSH_EVENTS,
  deliveryDecision,
  fcmEndpoint,
  fcmErrorCode,
  normalizePushClaim,
  notificationForEvent,
  parseServiceAccount,
  validFcmMessageName,
} from '../supabase/functions/fcm-push-worker/push-core.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const id='123e4567-e89b-42d3-a456-426614174000';

test('push suporta somente eventos operacionais aprovados',()=>{
  assert.deepEqual([...PUSH_EVENTS],['routine_due','refill_due','operational','account_security']);
});

test('mensagens de tela bloqueada são fixas, genéricas e sem conteúdo sensível',()=>{
  const all=PUSH_EVENTS.map(notificationForEvent);
  for(const item of all){
    assert.equal(item.title,'PepDay');
    assert.ok(item.body.length>10);
    assert.doesNotMatch(item.body,/dose|substância|histórico|pept[ií]deo|mg|mcg|\bUI\b/i);
  }
  assert.match(notificationForEvent('routine_due').body,/rotina programada para hoje/i);
  assert.match(notificationForEvent('refill_due').body,/aviso de reposição/i);
  assert.equal(notificationForEvent('unknown'),null);
});

test('claim aceita apenas evento, instalação e tentativa válidos',()=>{
  const claim=normalizePushClaim({
    outcome:'claimed',id,event_type:'routine_due',attempt:1,
    installation_id:'installation_1234567890'
  });
  assert.equal(claim.id,id);
  assert.equal(claim.eventType,'routine_due');
  assert.equal(claim.installationId,'installation_1234567890');
  assert.equal(normalizePushClaim({...claim,event_type:'marketing'}),null);
  assert.deepEqual(normalizePushClaim({outcome:'empty'}),{outcome:'empty'});
  assert.deepEqual(normalizePushClaim({outcome:'skipped',reason:'preference_disabled'}),{
    outcome:'skipped',reason:'preference_disabled'
  });
});

test('service account é validada sem expor ou aceitar configuração incompleta',()=>{
  const account=parseServiceAccount(JSON.stringify({
    project_id:'pepday-test-1234',
    client_email:'push@pepday-test-1234.iam.gserviceaccount.com',
    private_key:'-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----'
  }));
  assert.equal(account.projectId,'pepday-test-1234');
  assert.equal(parseServiceAccount('{}'),null);
  assert.equal(parseServiceAccount('not-json'),null);
});

test('endpoint FCM HTTP v1 é construído somente para project id válido',()=>{
  assert.equal(
    fcmEndpoint('pepday-test-1234'),
    'https://fcm.googleapis.com/v1/projects/pepday-test-1234/messages:send'
  );
  assert.equal(fcmEndpoint('https://evil.example'),null);
});

test('FCM 200 envia; transitórios repetem; erros permanentes encerram',()=>{
  assert.deepEqual(deliveryDecision(200,1),{outcome:'sent',retryAfterSeconds:null});
  assert.deepEqual(deliveryDecision(429,1),{outcome:'retry',retryAfterSeconds:60});
  assert.deepEqual(deliveryDecision(503,3),{outcome:'retry',retryAfterSeconds:240});
  assert.deepEqual(deliveryDecision(503,5),{outcome:'dead',retryAfterSeconds:null});
  assert.deepEqual(deliveryDecision(400,1),{outcome:'dead',retryAfterSeconds:null});
});

test('erro UNREGISTERED é reconhecido para desativar instalação morta',()=>{
  assert.equal(fcmErrorCode(404,{error:{details:[{errorCode:'UNREGISTERED'}]}}),'FCM_UNREGISTERED');
  assert.equal(fcmErrorCode(429,{}),'FCM_RATE_LIMIT');
  assert.equal(fcmErrorCode(500,{}),'FCM_SERVER_ERROR');
  assert.equal(validFcmMessageName('projects/pep/messages/abc','pep'),'projects/pep/messages/abc');
  assert.equal(validFcmMessageName('projects/other/messages/abc','pep'),null);
});

test('migration respeita todas as preferências e não armazena payload sensível',async()=>{
  const sql=await read('supabase/migrations/20260929004210_block_c_fcm_push_foundation.sql');
  assert.match(sql,/add column operational_notices boolean not null default true/);
  assert.match(sql,/when 'routine_due' then s\.routine_reminders/);
  assert.match(sql,/when 'refill_due' then s\.refill_alerts/);
  assert.match(sql,/when 'operational' then s\.operational_notices/);
  assert.match(sql,/when 'account_security' then s\.account_security_notices/);
  assert.match(sql,/for update skip locked/i);
  assert.match(sql,/FCM_UNREGISTERED[^]*update public\.push_installations/i);
  const outbox=sql.match(/create table public\.push_notification_outbox \(([^]*?)\n\);/i)?.[1]||'';
  assert.doesNotMatch(outbox,/payload|body|title|dose|substance|routine_name|vial_name/i);
});

test('cliente só registra instalação/preferências; worker RPCs ficam service-role-only',async()=>{
  const sql=await read('supabase/migrations/20260929004210_block_c_fcm_push_foundation.sql');
  assert.match(sql,/grant execute on function public\.register_push_installation\(text\)\s+to authenticated/i);
  assert.match(sql,/grant execute on function public\.disable_push_installation\(text\)\s+to authenticated/i);
  assert.match(sql,/grant execute on function public\.update_push_preferences\(boolean,boolean,boolean,boolean\)\s+to authenticated/i);
  assert.match(sql,/grant execute on function public\.enqueue_push_notification[^]*to service_role/i);
  assert.match(sql,/grant execute on function public\.claim_push_notification[^]*to service_role/i);
  assert.match(sql,/revoke all on public\.push_installations from public,anon,authenticated,service_role/i);
  assert.match(sql,/revoke all on public\.push_notification_outbox from public,anon,authenticated,service_role/i);
});

test('worker exige segredo antes do claim e usa OAuth/HTTP v1 somente no backend',async()=>{
  const source=await read('supabase/functions/fcm-push-worker/index.mjs');
  assert.ok(source.indexOf('internalSecretOk(req)')<source.indexOf('"claim_push_notification"'));
  assert.match(source,/FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.match(source,/PEPDAY_PUSH_WORKER_SECRET/);
  assert.match(source,/https:\/\/oauth2\.googleapis\.com\/token/);
  assert.match(source,/https:\/\/www\.googleapis\.com\/auth\/firebase\.messaging/);
  assert.match(source,/fcmEndpoint\(account\.projectId\)/);
  assert.doesNotMatch(source,/console\.log/);
  const logs=[...source.matchAll(/console\.(?:error|warn)\(([^\n]+)\)/g)].map(m=>m[1]).join('\n');
  assert.doesNotMatch(logs,/installation|token|privateKey|serviceAccount|recipient|payload/i);
});

test('config declara worker FCM sem JWT público e com segredo próprio',async()=>{
  const config=await read('supabase/config.toml');
  assert.match(config,/\[functions\.fcm-push-worker\][^]*verify_jwt = false[^]*fcm-push-worker\/index\.mjs/);
  assert.match(config,/autenticação por segredo próprio/i);
});


test('cliente Web Push exige gesto do usuário, VAPID público e RPCs de instalação/preferência',async()=>{
  const [source,html,publicConfig,worker]=await Promise.all([
    read('src/push.mjs'),
    read('index.html'),
    read('src/firebase-public-config.mjs'),
    read('src/firebase-messaging-sw.js')
  ]);
  assert.match(source,/Notification\.requestPermission\(\)/);
  assert.match(source,/getToken\(messaging/);
  assert.match(source,/vapidKey:firebasePublicConfig\.vapidKey/);
  assert.match(source,/register_push_installation/);
  assert.match(source,/update_push_preferences/);
  assert.match(source,/disable_push_installation/);
  assert.match(html,/id="pushEnable"/);
  assert.match(html,/id="pushRoutine"/);
  assert.match(html,/id="pushRefill"/);
  assert.match(html,/id="pushSecurity"/);
  assert.match(publicConfig,/pepday-v3-test/);
  assert.match(publicConfig,/vapidKey/);
  assert.doesNotMatch(publicConfig,/private_key|client_email/i);
  assert.match(worker,/firebase-messaging-compat\.js/);
  assert.match(worker,/firebase\.messaging\(\)/);
});


test('UX convida push após cadastro e após primeira rotina sem pedir automaticamente',async()=>{
  const [html,accountUi,app]=await Promise.all([
    read('index.html'),
    read('src/account-ui.mjs'),
    read('app.js')
  ]);
  assert.match(html,/id="pushInvite"/);
  assert.match(html,/id="pushInviteEnable"/);
  assert.match(html,/id="pushRoutineDialog"/);
  assert.match(html,/mesmo com o PepDay fechado/i);
  assert.match(accountUi,/renderPushInvite/);
  assert.match(accountUi,/pepday:first-routine-created/);
  assert.match(accountUi,/enableReminderPush/);
  assert.match(app,/wasFirstRoutine/);
  assert.match(app,/pepday:first-routine-created/);
  assert.doesNotMatch(accountUi,/Notification\.requestPermission\(\)/);
});
