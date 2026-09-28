import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPackage} from '../scripts/prepare-b22d2f-real-validation.mjs';
import {executePackage,validateD2fDatabaseUrl} from '../scripts/test-b22d2f-real-concurrency.mjs';

// Exercita orquestração e caminhos de falha; não simula PASS do banco real.
test('D2-F recusa limites de espera inválidos',()=>{
  for (const holdSeconds of [-1,21,Infinity,'12']) assert.throws(()=>buildPackage({holdSeconds}));
});
test('D2-F não aceita observação vazia ou mesma sessão como lock real',()=>{
  const c=buildPackage().scenarios[0];
  for (const rows of [[],null,[{blocker:1,waiter:1,wait_event_type:'Lock'}]]) assert.throws(()=>c.recordObservation(rows));
});
function mockPackage() {
  return {ids:{importId:'fixture',user:'fixture'},setup:'setup',verify:'verify',cleanup:'cleanup',remaining:'remaining',
    scenarios:[{name:'race',sqlA:'a',sqlB:'b',observeAndRecord:'observe'}]};
}
test('D2-F espera sessões terminarem e limpa mesmo quando observador falha',async()=>{
  let bFinished=false; let cleanup=false; let verified=false;
  await assert.rejects(executePackage(async(name,sql)=>{
    if(sql==='observe') throw new Error('lock ausente');
    if(sql==='b') bFinished=true;
    if(sql==='verify') verified=true;
    if(sql==='cleanup') { assert.ok(bFinished); cleanup=true; }
    return {rows:[{n:1,total_fixtures:0}]};
  },mockPackage()),/lock ausente/);
  assert.ok(cleanup); assert.equal(verified,false);
});
test('D2-F reporta falha de cleanup além da falha principal',async()=>{
  await assert.rejects(executePackage(async(name,sql)=>{
    if(sql==='setup') throw new Error('setup interrompido');
    if(sql==='cleanup') throw new Error('procedência inválida');
    return {rows:[{n:1,total_fixtures:0}]};
  },mockPackage()),/setup interrompido.*cleanup: procedência inválida/);
});
test('D2-F não declara PASS se cleanup deixa resíduos',async()=>{
  await assert.rejects(executePackage(async()=>({rows:[{n:1,total_fixtures:1}]}),mockPackage()),/Fixtures remanescentes/);
});

test('D2-F recusa projeto errado e pooler transacional antes de conectar',()=>{
  assert.throws(()=>validateD2fDatabaseUrl('postgresql://postgres.other:fixture@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?options=fsbqpyyprtymwrmzsacp'));
  assert.throws(()=>validateD2fDatabaseUrl('postgresql://postgres.fsbqpyyprtymwrmzsacp:fixture@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'));
  assert.throws(()=>validateD2fDatabaseUrl('postgresql://postgres:fixture@db.other.supabase.co:5432/postgres'));
});
