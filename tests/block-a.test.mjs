import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { inspectLegacy, snapshotLegacy, stageLegacyImport, LEGACY_KEYS } from '../src/legacy-import.mjs';
import { createAccountService } from '../src/account.mjs';

globalThis.crypto ??= webcrypto;
const id = '11111111-1111-4111-8111-111111111111';
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), data };
}
function fixture() {
  return storage({
    [LEGACY_KEYS[0]]: JSON.stringify([{ id, vialId:id, frequency:'5on2off', doseValue:1, doseUnit:'mg', syringeCapacity:30 }]),
    [LEGACY_KEYS[1]]: JSON.stringify([{ id, name:'Exemplo de teste', initialMg:10, remainingMg:8, waterMl:2, history:[] }]),
    [LEGACY_KEYS[2]]: '1'
  });
}
test('backup mantém bytes originais, tutorial e hash estável em tentativas repetidas', async () => {
  const s=fixture(), before=[...s.data];
  const a=await snapshotLegacy(s), b=await snapshotLegacy(s);
  assert.equal(a.hash,b.hash);
  for(const [k,v] of before) assert.equal(s.getItem(k),v);
  assert.equal(s.data.size,4);
  assert.equal(a.snapshot.raw[LEGACY_KEYS[2]],'1');
});
test('dados corrompidos não são substituídos por lista vazia', () => {
  const s=storage({[LEGACY_KEYS[0]]:'{corrompido'});
  assert.throws(()=>inspectLegacy(s),/inválidos/);
  assert.equal(s.getItem(LEGACY_KEYS[0]),'{corrompido');
});
test('quota insuficiente interrompe antes do envio', async () => {
  const s=fixture(); s.setItem=()=>{throw new Error('QuotaExceededError');};
  let calls=0;
  await assert.rejects(stageLegacyImport({auth:{getUser:async()=>({data:{user:{id}}})},rpc:()=>{calls++;}},s,
    {consent:true,expectedUserId:id}),/Quota/);
  assert.equal(calls,0);
});
test('migração exige consentimento explícito antes de autenticar/enviar', async () => {
  await assert.rejects(stageLegacyImport({},fixture(),{consent:false,expectedUserId:id}),/escolha explícita/);
});
test('troca de conta interrompe envio', async () => {
  await assert.rejects(stageLegacyImport({auth:{getUser:async()=>({data:{user:{id:'outra'}}})}},fixture(),
    {consent:true,expectedUserId:id}),/conta/);
});
test('histórico antigo fica preservado e é sinalizado para revisão', () => {
  const s=fixture(), v=JSON.parse(s.getItem(LEGACY_KEYS[1]));
  v[0].history=[{type:'undo',mg:1}]; s.setItem(LEGACY_KEYS[1],JSON.stringify(v));
  const data=inspectLegacy(s);
  assert.match(data.issues.join(' '),/histórico legado/);
  assert.deepEqual(data.vials[0].history,v[0].history);
});
test('identificador 5on2off aceito; 5x2 nunca normalizado silenciosamente', () => {
  const s=fixture(); assert.equal(inspectLegacy(s).issues.length,0);
  s.setItem(LEGACY_KEYS[0],s.getItem(LEGACY_KEYS[0]).replace('5on2off','5x2'));
  assert.match(inspectLegacy(s).issues.join(' '),/Frequência inválida/);
});
test('envio conferido é staged, nunca importação concluída', async () => {
  const s=fixture(); let saved;
  const query={select(){return this;},eq(){return this;},async single(){return {data:saved};}};
  const client={auth:{getUser:async()=>({data:{user:{id}}})},
    async rpc(name,p){assert.equal(p.p_expected_user,id);saved={id:'import-id',user_id:id,source_hash:p.p_hash,source_snapshot:p.p_snapshot,status:'staged'};
      return {data:'import-id'};},from:()=>query};
  const result=await stageLegacyImport(client,s,{consent:true,expectedUserId:id});
  assert.equal(result.status,'staged');
  assert.ok(s.getItem(LEGACY_KEYS[0]));
});
test('divergência no snapshot remoto bloqueia confirmação e mantém backup', async () => {
  const s=fixture();
  const query={select(){return this;},eq(){return this;},async single(){return {data:{user_id:id,source_hash:'diverge'}};}};
  const client={auth:{getUser:async()=>({data:{user:{id}}})},rpc:async()=>({data:'import-id'}),from:()=>query};
  await assert.rejects(stageLegacyImport(client,s,{consent:true,expectedUserId:id}),/conferência/);
  assert.ok([...s.data.keys()].some(k=>k.startsWith('pepday_v3_backup_')));
});
const options={redirectTo:'https://example.test/pepday/',allowedRedirects:['https://example.test/pepday/']};
test('criar serviço e consultar sessão não inicia trial', async () => {
  const calls=[];
  const svc=createAccountService({auth:{getSession:async()=>({data:{session:null}})},rpc:async n=>{calls.push(n);return {data:{}};}},options);
  await svc.session(); assert.deepEqual(calls,[]);
  await svc.startTrial(); assert.deepEqual(calls,['start_trial']);
});
test('redirecionamento externo ou HTTP não autorizado é rejeitado', () => {
  assert.throws(()=>createAccountService({}, {...options,redirectTo:'https://evil.test/'}),/autorizada/);
  assert.throws(()=>createAccountService({}, {redirectTo:'http://example.test/',allowedRedirects:['http://example.test/']}),/HTTPS/);
});
test('OTP de seis dígitos e erro do provedor são propagados', async () => {
  const svc=createAccountService({auth:{verifyOtp:async()=>({error:new Error('Código expirado')})}},options);
  assert.throws(()=>svc.verifyCode('a@example.test','123'),/6 dígitos/);
  await assert.rejects(svc.verifyCode('a@example.test','123456'),/expirado/);
});
test('aceites são obrigatórios; marketing é opcional', async () => {
  let args;
  const svc=createAccountService({rpc:async(n,p)=>{args=p;return {data:null};}},options);
  assert.throws(()=>svc.completeProfile({adult:false}),/maioridade/);
  await svc.completeProfile({adult:true,termsAccepted:true,privacyAccepted:true,name:'Teste',country:'BR',
    timezone:'America/Sao_Paulo',termsVersion:'test',privacyVersion:'test'});
  assert.equal(args.p_marketing,false);
});
