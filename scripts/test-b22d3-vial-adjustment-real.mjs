import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
import {validateD2fDatabaseUrl} from './test-b22d2f-real-concurrency.mjs';

const q=value=>String(value).replaceAll("'","''");
const marker=randomUUID(),user=randomUUID(),vial=randomUUID(),importId=randomUUID();
const createOp=randomUUID(),adjustOp=randomUUID(),staleOp=randomUUID(),increaseOp=randomUUID();
const email=`pepday-d3-adjust-${marker}@example.invalid`;
const sourceHash=createHash('sha256').update(marker).digest('hex');
const ids={marker,user,vial,importId,createOp,adjustOp,staleOp,increaseOp,email};
const idsMatch=actual=>actual&&Object.keys(actual).length===Object.keys(ids).length&&Object.entries(ids).every(([key,value])=>actual[key]===value);

function fail(message){throw new Error(message)}
function result(row,key){const value=row?.rows?.[0]?.[key];if(!value)fail(`Resposta ausente: ${key}`);return value}
async function authTx(client,sql,params=[]){
  await client.query('begin');
  try{
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    const out=await client.query(sql,params);
    await client.query('reset role');await client.query('commit');return out;
  }catch(error){await client.query('rollback').catch(()=>{});throw error}
}
async function setup(client){
  await client.query('begin');
  try{
    await client.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[user,email,{pepday_d3_adjust_marker:marker}]);
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await client.query("select public.complete_onboarding('D3 Adjustment','BR','America/Sao_Paulo',true,'d3','d3',false)");
    await client.query('select public.start_trial()');
    await client.query('reset role');
    await client.query(`insert into public.local_data_imports(id,user_id,source_hash,source_version,status,source_snapshot,verification,completed_at)
      values($1,$2,$3,'b22d3-adjust-real','completed',$4,$5,now())`,
      [importId,user,sourceHash,{fixture:'pepday-b22d3-adjust',run_marker:marker,ids},{purpose:'cleanup-provenance'}]);
    await client.query('commit');
  }catch(error){await client.query('rollback').catch(()=>{});throw error}
}
async function runScenarios(client){
  const created=result(await authTx(client,
    `select public.create_vial_versioned($1,$2,$3,'D3 adjustment',10,2,current_date,0) result`,
    [createOp,user,vial]),'result');
  if(created.outcome!=='success'||created.replay!==false||Number(created.vial?.remaining_mg)!==10)fail('Create do frasco divergiu');

  const adjusted=result(await authTx(client,
    'select public.adjust_vial_balance_versioned($1,$2,$3,10,7) result',[adjustOp,user,vial]),'result');
  if(adjusted.outcome!=='success'||adjusted.replay!==false||Number(adjusted.vial?.remaining_mg)!==7
    ||adjusted.movement?.kind!=='adjustment'||Number(adjusted.movement?.delta_mg)!==-3)fail('Ajuste 10→7 divergiu');
  const replay=result(await authTx(client,
    'select public.adjust_vial_balance_versioned($1,$2,$3,10,7) result',[adjustOp,user,vial]),'result');
  if(replay.outcome!=='success'||replay.replay!==true||replay.movement?.id!==adjusted.movement?.id)fail('Replay do ajuste divergiu');

  const stale=result(await authTx(client,
    'select public.adjust_vial_balance_versioned($1,$2,$3,10,5) result',[staleOp,user,vial]),'result');
  if(stale.outcome!=='conflict'||stale.code!=='STALE_BALANCE'||stale.replay!==false
    ||Number(stale.remote_balance)!==7)fail('Conflito STALE_BALANCE divergiu');

  const increased=result(await authTx(client,
    'select public.adjust_vial_balance_versioned($1,$2,$3,7,8) result',[increaseOp,user,vial]),'result');
  if(increased.outcome!=='success'||Number(increased.vial?.remaining_mg)!==8
    ||Number(increased.movement?.delta_mg)!==1)fail('Ajuste 7→8 divergiu');

  const checks=await client.query(`select
    (select count(*)::int from public.vial_movements where user_id=$1 and vial_id=$2 and kind='adjustment') movements,
    (select count(*)::int from public.domain_mutation_operations where user_id=$1 and entity_id=$2) ledger,
    (select remaining_mg from public.vials where user_id=$1 and id=$2) balance,
    (select version from public.vials where user_id=$1 and id=$2) version,
    (select edit_version from public.vials where user_id=$1 and id=$2) edit_version`,[user,vial]);
  const c=checks.rows[0];
  if(c.movements!==2||c.ledger!==4||Number(c.balance)!==8||Number(c.version)!==3||Number(c.edit_version)!==1)
    fail('Cardinalidade/versionamento final divergiu');
}
async function cleanup(client){
  await client.query('begin');
  try{
    const guard=await client.query(`select source_snapshot from public.local_data_imports
      where id=$1 and user_id=$2 and source_hash=$3 for update`,[importId,user,sourceHash]);
    const snapshot=guard.rows[0]?.source_snapshot;
    if(snapshot?.fixture!=='pepday-b22d3-adjust'||snapshot?.run_marker!==marker||!idsMatch(snapshot?.ids))
      fail('Cleanup recusado: proveniência divergente');
    const auth=await client.query(`select email,raw_user_meta_data from auth.users where id=$1 for update`,[user]);
    if(auth.rows[0]?.email!==email||auth.rows[0]?.raw_user_meta_data?.pepday_d3_adjust_marker!==marker)
      fail('Cleanup recusado: Auth divergente');
    const unexpected=await client.query(`select
      (select count(*)::int from public.vials where user_id=$1 and id<>$2) vials,
      (select count(*)::int from public.routines where user_id=$1) routines,
      (select count(*)::int from public.applications where user_id=$1) applications`,[user,vial]);
    if(Object.values(unexpected.rows[0]).some(Number))fail('Cleanup recusado: dados inesperados');
    await client.query('delete from auth.users where id=$1 and email=$2',[user,email]);
    await client.query('commit');
  }catch(error){await client.query('rollback').catch(()=>{});throw error}
}
async function verifyZero(client){
  const row=await client.query(`select
    (select count(*) from auth.users where id=$1)+
    (select count(*) from public.profiles where id=$1)+
    (select count(*) from public.vials where user_id=$1)+
    (select count(*) from public.vial_movements where user_id=$1)+
    (select count(*) from public.domain_mutation_operations where user_id=$1)+
    (select count(*) from public.local_data_imports where user_id=$1) total`,[user]);
  if(Number(row.rows[0].total)!==0)fail('Cleanup deixou resíduos');
}
const connectionString=validateD2fDatabaseUrl(process.env.SUPABASE_DB_URL);
const client=new Client({connectionString,connectionTimeoutMillis:15000,query_timeout:40000,
  ssl:{rejectUnauthorized:true},application_name:'pepday-d3-adjust-real'});
client.on('error',()=>{});
let failure=null,cleanupFailure=null;
try{
  await client.connect();await setup(client);await runScenarios(client);
}catch(error){failure=error}
finally{
  try{await cleanup(client);await verifyZero(client)}catch(error){cleanupFailure=error}
  await client.end().catch(()=>{});
}
if(failure||cleanupFailure){
  const safe=[failure&&`validação: ${failure.message}`,cleanupFailure&&`cleanup: ${cleanupFailure.message}`].filter(Boolean).join('; ')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[REDACTED_DB_URL]');
  console.error(`FAIL D3 ADJUSTMENT — ${safe}`);process.exitCode=1;
}else console.log('PASS FINAL D3 ADJUSTMENT — ajuste, replay, conflito, histórico, versões e cleanup zero');
