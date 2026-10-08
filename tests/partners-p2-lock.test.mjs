import test from 'node:test';
import assert from 'node:assert/strict';
import {readPartnerLock,lockedMessage} from '../src/partner-lock.mjs';
const client=(identity,result)=>({auth:{getUser:async()=>identity},rpc:name=>{
  assert.equal(name,'get_my_partner_attribution');
  return {abortSignal:signal=>{assert.ok(signal instanceof AbortSignal);return Promise.resolve(result)}};
}});
const signedIn={data:{user:{id:'synthetic'}}};
test('P2 unauthenticated visitor keeps pre-lock flow without a claim or read RPC',async()=>{
  for(const identity of [{data:{}},{error:{name:'AuthSessionMissingError'}}]){
    assert.deepEqual(await readPartnerLock({auth:{getUser:async()=>identity},rpc:()=>assert.fail('RPC while signed out')}),{partner_locked:false,partner:null});
  }
});
test('P2 authenticated lock survives absent local intent and projects only public fields',async()=>{
  const result=await readPartnerLock(client(signedIn,{data:{partner_locked:true,partner:{public_name:'Original',city:'A',description:'@a',email:'private',phone:'private',cpf:'private',pix:'private',commission_percent:16}}}));
  assert.deepEqual(result,{partner_locked:true,partner:{public_name:'Original',city:'A',description:'@a'}});
  assert.match(lockedMessage(result),/Original.*não pode ser alterada/);
});
test('P2 sealed absence and a new ref produce definitive feedback',async()=>{
  const result=await readPartnerLock(client(signedIn,{data:{partner_locked:true,partner:null}}));
  assert.equal(result.partner,null);assert.match(lockedMessage(result,true),/sem indicação.*não pode.*referência.*ignorada/);
  assert.match(lockedMessage({partner:{public_name:'Original'}},true),/Original.*ignorada/);
});
test('P2 authenticated pre-lock remains editable; stray partner is ignored',async()=>{
  assert.deepEqual(await readPartnerLock(client(signedIn,{data:{partner_locked:false,partner:{public_name:'Untrusted'}}})),{partner_locked:false,partner:null});
});
test('P2 unavailable Auth/RPC or malformed state must not be treated as unlocked',async()=>{
  for(const c of [client({error:{message:'secret error'}},{}),client(signedIn,{error:{message:'secret error'}}),client(signedIn,{data:{}})]){
    await assert.rejects(readPartnerLock(c),e=>/conferir sua indicação/.test(e.message)&&!e.message.includes('secret'));
  }
});
