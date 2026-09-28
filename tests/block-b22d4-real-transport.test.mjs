import test from 'node:test';
import assert from 'node:assert/strict';
import {runD4Transport} from '../scripts/test-b22d4-real-transport.mjs';

const ENV={SUPABASE_URL:'https://fsbqpyyprtymwrmzsacp.supabase.co',
  SUPABASE_ANON_KEY:'anon-fixture',SUPABASE_SERVICE_ROLE_KEY:'service-fixture'};
let seq=0;const uuid=()=>`d4000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`;

function b2Fixture(flags){
  const state={users:[],sessions:[]};
  return {state,factory:()=>({_test:{state,
    preflight:async()=>{},
    createAccount:async(email)=>{
      const label=email.includes('-a@')?'a':'b',id=label==='a'?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      state.users.push({id,email});state.sessions.push({id,email,access_token:`token-${label}`,refresh_token:`refresh-${label}`});
    },
    prepare:async()=>{},cleanup:async()=>{flags.cleaned=true},verifyCleanup:async()=>{flags.verified=true}
  }})};
}

function fakeTransport(flags,{allowCross=false}={}){
  let vialId,routineId,vial={edit_version:1},routine={version:1},routineVersions=[];
  const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
  return async(input,init={})=>{
    const url=new URL(input),body=init.body?JSON.parse(init.body):null;
    const token=new Headers(init.headers).get('authorization')?.replace('Bearer ','');
    const rpc=url.pathname.match(/\/rpc\/([^/]+)$/)?.[1];
    if(rpc){
      flags.calls.push({rpc,token});
      if(rpc==='create_vial_versioned'){vialId=body.p_vial_id;vial={id:vialId,user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name:'D4 HTTP vial',initial_mg:10,remaining_mg:10,water_ml:2,prepared_on:body.p_prepared_on,cost:0,active:true,version:1,edit_version:1,deleted_at:null};
        return response({outcome:'success',replay:flags.calls.filter(x=>x.rpc===rpc).length>1,vial});}
      if(rpc==='create_routine_versioned'&&token==='token-b'&&!allowCross)return response({outcome:'conflict',replay:false,code:'VIAL_NOT_AVAILABLE'});
      if(rpc==='create_routine_versioned'){routineId=body.p_routine_id;routine={id:routineId,user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        vial_id:vialId,name:'D4 HTTP routine',dose_value:1,dose_unit:'mg',syringe_capacity:100,frequency:'daily',weekdays:[],
        start_date:body.p_start_date,time_of_day:null,refill_at:3,status:'active',version:1,deleted_at:null};routineVersions=[1];
        return response({outcome:'success',replay:false,routine,routine_version_id:body.p_routine_version_id});}
      if(rpc==='update_vial_versioned'){vial={...vial,name:'D4 HTTP vial updated',version:2,edit_version:2};return response({outcome:'success',replay:false,vial});}
      if(rpc==='update_routine_versioned'&&token==='token-b'&&!allowCross)return response({outcome:'conflict',replay:false,code:'ENTITY_NOT_FOUND'});
      if(rpc==='update_routine_versioned'){routine={...routine,name:'D4 HTTP routine updated',version:2};routineVersions.push(2);
        return response({outcome:'success',replay:false,routine,routine_version_id:body.p_new_routine_version_id});}
      if(rpc==='soft_delete_routine_versioned'){routine={...routine,status:'deleted',version:3,deleted_at:'2026-09-28T15:00:00Z'};routineVersions.push(3);
        return response({outcome:'success',replay:false,routine,routine_version_id:body.p_new_routine_version_id});}
      if(rpc==='soft_delete_vial_versioned'){vial={...vial,active:false,version:3,edit_version:3,deleted_at:'2026-09-28T15:00:01Z'};
        return response({outcome:'success',replay:false,vial});}
    }
    if(url.pathname.endsWith('/vials')){
      if(token==='token-b')return response([]);
      return response([{id:vialId,deleted_at:vial.deleted_at,edit_version:vial.edit_version}]);
    }
    if(url.pathname.endsWith('/routines')){
      if(token==='token-b')return response([]);
      return response([{id:routineId,deleted_at:routine.deleted_at,version:routine.version,vial_id:vialId}]);
    }
    if(url.pathname.endsWith('/routine_versions'))return response(routineVersions.map((version,index)=>({id:`rv-${index}`,version})));
    if(url.pathname.endsWith('/domain_mutation_operations'))return response(flags.cleaned?[]:[1,2,3,4,5,6].map(i=>({operation_id:`op-${i}`,outcome:'success'})));
    return new Response('{}',{status:404,headers:{'content-type':'application/json'}});
  };
}

test('D4 percorre create/edit/delete HTTP com RLS e cleanup',async()=>{
  seq=0;const flags={calls:[],cleaned:false,verified:false},b2=b2Fixture(flags);
  const result=await runD4Transport({env:ENV,fetchImpl:fakeTransport(flags),uuid,b2Factory:b2.factory});
  assert.match(result,/PASS FINAL B2\.2-D4/);assert.equal(flags.cleaned,true);assert.equal(flags.verified,true);
  assert.deepEqual(flags.calls.filter(x=>x.token==='token-a').map(x=>x.rpc),[
    'create_vial_versioned','create_vial_versioned','create_routine_versioned','update_vial_versioned',
    'update_routine_versioned','soft_delete_routine_versioned','soft_delete_vial_versioned']);
});
test('D4 falha se RLS permitir mutação cruzada e ainda limpa',async()=>{
  seq=0;const flags={calls:[],cleaned:false,verified:false},b2=b2Fixture(flags);
  await assert.rejects(runD4Transport({env:ENV,fetchImpl:fakeTransport(flags,{allowCross:true}),uuid,b2Factory:b2.factory}),
    /B conseguiu criar Rotina apontando para Frasco de A/);
  assert.equal(flags.cleaned,true);assert.equal(flags.verified,true);
});

test('D4 recusa projeto errado antes de criar fixture',async()=>{
  let called=false;
  await assert.rejects(runD4Transport({env:{...ENV,SUPABASE_URL:'https://outro.supabase.co'},fetchImpl:async()=>{throw new Error('não deveria chamar')},
    uuid,b2Factory:()=>{called=true;return null}}),/não corresponde ao pepday-v3-test/);
  assert.equal(called,false);
});
