// B2.2-D4: transporte HTTP/Auth/JWT real de Frascos e Rotinas no pepday-v3-test.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createB2Automation } from './test-b2-real-transport.mjs';

const EXPECTED_URL='https://fsbqpyyprtymwrmzsacp.supabase.co';
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const safe=async response=>{const text=await response.text();if(!text)return null;try{return JSON.parse(text)}catch{return null}};

export async function runD4Transport({env=process.env,fetchImpl=fetch,uuid=randomUUID,b2Factory=createB2Automation}={}){
  const required=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
  for(const key of required)if(!env[key])throw new Error(`Variável obrigatória ausente: ${key}`);
  assert(env.SUPABASE_URL===EXPECTED_URL,'SUPABASE_URL não corresponde ao pepday-v3-test');
  const b2=b2Factory({env,fetchImpl,uuid});
  const state=b2._test.state;
  const base=env.SUPABASE_URL,anon=env.SUPABASE_ANON_KEY,service=env.SUPABASE_SERVICE_ROLE_KEY;
  const secrets=[anon,service,env.SUPABASE_DB_URL];
  const headers=(key,token=key)=>({apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'});

  async function http(path,{method='GET',key=anon,token=key,body,allowFailure=false}={}){
    const response=await fetchImpl(`${base}${path}`,{method,headers:headers(key,token),
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60_000)});
    const data=await safe(response);
    if(!response.ok&&!allowFailure)throw new Error(`HTTP ${response.status} em ${method} ${path.split('?')[0]}`);
    return {ok:response.ok,status:response.status,data};
  }
  const rpc=(session,name,body,options={})=>http(`/rest/v1/rpc/${name}`,{method:'POST',token:session.access_token,body,...options});
  const rows=(session,table,query)=>http(`/rest/v1/${table}?${query}`,{token:session.access_token});
  const serviceRows=(table,query)=>http(`/rest/v1/${table}?${query}`,{key:service});
  const ids={vial:uuid(),routine:uuid(),rv1:uuid(),rv2:uuid(),rv3:uuid(),
    vialCreate:uuid(),vialUpdate:uuid(),vialDelete:uuid(),
    routineCreate:uuid(),routineUpdate:uuid(),routineDelete:uuid(),
    crossRoutine:uuid(),crossUpdate:uuid()};
  let failure=null,cleanupFailure=null;
  try{
    await b2._test.preflight();
    await b2._test.createAccount('pepday-b2-jwt-a@example.invalid','A');
    await b2._test.createAccount('pepday-b2-jwt-b@example.invalid','B');
    await b2._test.prepare();
    const [a,b]=state.sessions; const userA=state.users[0].id,userB=state.users[1].id;
    const today=new Date().toISOString().slice(0,10);

    const vialArgs={p_operation_id:ids.vialCreate,p_expected_user:userA,p_vial_id:ids.vial,
      p_name:'D4 HTTP vial',p_initial_mg:10,p_water_ml:2,p_prepared_on:today,p_cost:0};
    const vialCreate=await rpc(a,'create_vial_versioned',vialArgs);
    assert(vialCreate.data?.outcome==='success'&&vialCreate.data?.replay===false,'Create Frasco HTTP falhou');
    assert(vialCreate.data.vial?.id===ids.vial,'Create Frasco retornou ID divergente');
    const vialReplay=await rpc(a,'create_vial_versioned',vialArgs);
    assert(vialReplay.data?.outcome==='success'&&vialReplay.data?.replay===true,'Replay Create Frasco falhou');

    const routineArgs={p_operation_id:ids.routineCreate,p_expected_user:userA,p_routine_id:ids.routine,
      p_routine_version_id:ids.rv1,p_vial_id:ids.vial,p_name:'D4 HTTP routine',p_dose_value:1,p_dose_unit:'mg',
      p_syringe_capacity:100,p_frequency:'daily',p_weekdays:[],p_start_date:today,p_time_of_day:null,p_refill_at:3};
    const routineCreate=await rpc(a,'create_routine_versioned',routineArgs);
    assert(routineCreate.data?.outcome==='success'&&routineCreate.data?.replay===false,'Create Rotina HTTP falhou');
    assert(routineCreate.data?.routine?.vial_id===ids.vial&&routineCreate.data?.routine_version_id===ids.rv1,
      'Encadeamento Frasco → Rotina divergente');
    const [bVial,bRoutine]=await Promise.all([
      rows(b,'vials',`id=eq.${ids.vial}&select=id`),
      rows(b,'routines',`id=eq.${ids.routine}&select=id`)
    ]);
    assert(Array.isArray(bVial.data)&&bVial.data.length===0,'RLS permitiu B ler Frasco de A');
    assert(Array.isArray(bRoutine.data)&&bRoutine.data.length===0,'RLS permitiu B ler Rotina de A');

    const crossCreate=await rpc(b,'create_routine_versioned',{...routineArgs,p_operation_id:ids.crossRoutine,
      p_expected_user:userB,p_routine_id:uuid(),p_routine_version_id:uuid()},{allowFailure:true});
    assert(!crossCreate.ok||crossCreate.data?.outcome==='conflict'||crossCreate.data?.code,
      'B conseguiu criar Rotina apontando para Frasco de A');

    const vialBase=vialCreate.data.vial;
    const vialUpdate=await rpc(a,'update_vial_versioned',{p_operation_id:ids.vialUpdate,p_expected_user:userA,
      p_vial_id:ids.vial,p_expected_edit_version:Number(vialBase.edit_version??1),p_base:vialBase,p_patch:{name:'D4 HTTP vial updated'}});
    assert(vialUpdate.data?.outcome==='success'&&vialUpdate.data?.vial?.name==='D4 HTTP vial updated','Update Frasco HTTP falhou');

    const routineBase=routineCreate.data.routine;
    const routineUpdate=await rpc(a,'update_routine_versioned',{p_operation_id:ids.routineUpdate,p_expected_user:userA,
      p_routine_id:ids.routine,p_new_routine_version_id:ids.rv2,p_expected_version:Number(routineBase.version??1),
      p_base:routineBase,p_patch:{name:'D4 HTTP routine updated'}});
    assert(routineUpdate.data?.outcome==='success'&&routineUpdate.data?.routine_version_id===ids.rv2,
      'Update Rotina HTTP falhou');

    const crossUpdate=await rpc(b,'update_routine_versioned',{p_operation_id:ids.crossUpdate,p_expected_user:userB,
      p_routine_id:ids.routine,p_new_routine_version_id:uuid(),p_expected_version:Number(routineUpdate.data.routine?.version??2),
      p_base:routineUpdate.data.routine,p_patch:{name:'forbidden'}},{allowFailure:true});
    assert(!crossUpdate.ok||crossUpdate.data?.outcome==='conflict'||crossUpdate.data?.code,
      'B conseguiu editar Rotina de A');
    const routineDelete=await rpc(a,'soft_delete_routine_versioned',{p_operation_id:ids.routineDelete,p_expected_user:userA,
      p_routine_id:ids.routine,p_new_routine_version_id:ids.rv3,p_expected_version:Number(routineUpdate.data.routine?.version??2),
      p_base:routineUpdate.data.routine});
    assert(routineDelete.data?.outcome==='success'&&routineDelete.data?.routine?.deleted_at,'Delete Rotina HTTP falhou');

    const vialDelete=await rpc(a,'soft_delete_vial_versioned',{p_operation_id:ids.vialDelete,p_expected_user:userA,
      p_vial_id:ids.vial,p_expected_edit_version:Number(vialUpdate.data.vial?.edit_version??2),p_base:vialUpdate.data.vial});
    assert(vialDelete.data?.outcome==='success'&&vialDelete.data?.vial?.deleted_at,'Delete Frasco HTTP falhou');

    const [aVial,aRoutine,versions]=await Promise.all([
      rows(a,'vials',`id=eq.${ids.vial}&select=id,deleted_at,edit_version`),
      rows(a,'routines',`id=eq.${ids.routine}&select=id,deleted_at,version,vial_id`),
      rows(a,'routine_versions',`routine_id=eq.${ids.routine}&select=id,version`)
    ]);
    assert(aVial.data?.[0]?.deleted_at&&Number(aVial.data[0].edit_version)===3,'Estado final do Frasco incorreto');
    assert(aRoutine.data?.[0]?.deleted_at&&Number(aRoutine.data[0].version)===3&&aRoutine.data[0].vial_id===ids.vial,
      'Estado final da Rotina incorreto');
    assert(Array.isArray(versions.data)&&versions.data.length===3,'Rotina não preservou três versões imutáveis');
  }catch(error){failure=error}
  finally{
    try{
      if(state.users.length){await b2._test.cleanup();await b2._test.verifyCleanup()}

    }catch(error){cleanupFailure=error}
  }
  if(failure||cleanupFailure){
    let message=[failure?.message,cleanupFailure&&`cleanup: ${cleanupFailure.message}`].filter(Boolean).join(' | ');
    for(const secret of secrets.filter(Boolean))message=message.split(secret).join('[REDACTED]');
    throw new Error(message);
  }
  return 'PASS FINAL B2.2-D4 — HTTP/Auth/JWT Frasco → Rotina create/edit/delete + RLS + cleanup zero';
}

export async function main(options){
  try{console.log(await runD4Transport(options));return 0}
  catch(error){console.error(`FAIL B2.2-D4 — ${error.message}`);return 1}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main();
