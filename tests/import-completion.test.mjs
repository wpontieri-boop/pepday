import test from 'node:test';
import assert from 'node:assert/strict';
import { accountError } from '../src/cloud.mjs';
import { webcrypto } from 'node:crypto';
import { LEGACY_KEYS } from '../src/legacy-import.mjs';
import { reviewLegacy, verifyImportReceipt, completeLegacyImport } from '../src/import-completion.mjs';
globalThis.crypto??=webcrypto;
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',vial='11111111-1111-4111-8111-111111111111',routine='22222222-2222-4222-8222-222222222222';
function fixture(){
  const values=new Map([
    [LEGACY_KEYS[0],JSON.stringify([{id:routine,vialId:vial,name:'Fixture',doseValue:1000,doseUnit:'mcg',syringeCapacity:30,frequency:'5on2off',start:'2026-09-10',time:'08:00',weekdays:[],done:['2026-09-09'],doseHistory:[]}])],
    [LEGACY_KEYS[1],JSON.stringify([{id:vial,name:'Fixture',initialMg:10,remainingMg:8,waterMl:2,date:'2026-09-10',history:[{type:'undo',mg:1}]}])]
  ]);
  return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
}
function server(storage,{tamper=false,switchUser=false,changeLocal=false}={}) {
  let staged,completed=false;
  const query={select(){return this;},eq(){return this;},async single(){return {data:staged};}};
  return {auth:{getUser:async()=>({data:{user:{id:completed&&switchUser?'other':user}}})},from:()=>query,
    async rpc(name,args){
      if(name==='stage_local_import') {staged={id:'import-1',user_id:user,source_hash:args.p_hash,source_snapshot:args.p_snapshot}; return {data:staged.id};}
      if(name==='complete_local_import'){
        completed=true;
        if(changeLocal)storage.setItem(LEGACY_KEYS[2],'changed');
        return {data:{}};
      }
      assert.equal(name,'get_local_import_receipt');
      return {data:{import_id:'import-1',user_id:user,source_hash:staged.source_hash,status:'completed',completed_at:'2026-09-10T12:00:00Z',
        records:[{kind:'vial',legacy_id:vial,target_id:vial,verified:!tamper},{kind:'routine',legacy_id:routine,target_id:routine,verified:true}]}};
    }};
}
test('revisão preserva histórico incompleto sem impedir conversão do estado atual',()=>{
  const s=fixture(),r=reviewLegacy(s);
  assert.deepEqual(r.errors,[]); assert.deepEqual(r.vials[0].history,[{type:'undo',mg:1}]);
  const invalid=JSON.parse(s.getItem(LEGACY_KEYS[0]));invalid[0].start='2026-02-30';
  s.setItem(LEGACY_KEYS[0],JSON.stringify(invalid)); assert.ok(reviewLegacy(s).errors.length);
});
test('conclusão verifica recibo persistido e mantém todos os bytes locais',async()=>{
  const s=fixture(),before=[...s.values];
  const result=await completeLegacyImport(server(s),s,{consent:true,expectedUserId:user,mode:'merge'});
  assert.equal(result.status,'completed');
  for(const [k,v] of before)assert.equal(s.getItem(k),v);
  assert.equal([...s.values.keys()].filter(k=>k.startsWith('pepday_v3_import_completed_')).length,1);
});
for(const [name,options] of [['recibo divergente',{tamper:true}],['troca de conta na conclusão',{switchUser:true}],['edição local durante envio',{changeLocal:true}]]){
  test(name+' não marca conclusão local',async()=>{
    const s=fixture();
    await assert.rejects(completeLegacyImport(server(s,options),s,{consent:true,expectedUserId:user,mode:'merge'}));
    assert.equal([...s.values.keys()].some(k=>k.startsWith('pepday_v3_import_completed_')),false);
    assert.ok(s.getItem(LEGACY_KEYS[0]));
  });
}
test('recibo com quantidade correta mas identidade duplicada é rejeitado',()=>{
  const review=reviewLegacy(fixture()),row={kind:'vial',legacy_id:vial,target_id:vial,verified:true};
  assert.throws(()=>verifyImportReceipt({user_id:user,source_hash:'h',import_id:'i',status:'completed',completed_at:'date',records:[row,row]},
    {userId:user,hash:'h',importId:'i',review}),/Divergência/);
});
test('sem escolha explícita não envia nem guarda confirmação',async()=>{
  await assert.rejects(completeLegacyImport({},fixture(),{consent:false,expectedUserId:user,mode:'merge'}),/consentimento/);
});

test('conflito conhecido é explicado sem expor mensagens arbitrárias do servidor',()=>{
  assert.match(accountError({code:'P0001',message:'Conflito no legado; nenhum saldo foi sobrescrito'}),/conflitantes/);
  assert.doesNotMatch(accountError({code:'P0001',message:'private-payload'}),/private-payload/);
});
