// PepDay TEST: local synthetic PostgreSQL 17 backup/restore drill. Never connects to Supabase.
import {execFileSync,spawnSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,appendFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

const scope='PEPDAY_TEST_SYNTHETIC_PG17_ISOLATED';
const binDir=join(process.env.LOCALAPPDATA||'', 'PepDay','tools','postgresql-17.11','pgsql','bin');
export const required=['initdb.exe','pg_ctl.exe','pg_dump.exe','pg_restore.exe','psql.exe','createdb.exe'];
export function offlineOnly({env=process.env,tools=required}={}){
  return env?.LOCALAPPDATA&&tools.every(name=>name.endsWith('.exe'))
    && !env.PEPDAY_ALLOW_REMOTE_BACKUP && !env.PEPDAY_PROD_RESTORE;
}
const sha=b=>createHash('sha256').update(b).digest('hex');
function run(name,args,{env,timeout=35000}={}){
  const file=join(binDir,name);
  if(!required.includes(name)||!existsSync(file))throw Error('SYNTHETIC_RUNTIME_MISSING');
  const r=spawnSync(file,args,{env,windowsHide:true,shell:false,encoding:'utf8',maxBuffer:262144,timeout,stdio:name==='pg_ctl.exe'?'ignore':'pipe'});
  if(r.error||r.status!==0)throw Error('SYNTHETIC_STEP_FAILED_'+name);
  return r.stdout?.trim()||'';
}
function runStatus(name,args,env){
  const f=join(binDir,name);
  if(!existsSync(f))return false;
  const r=spawnSync(f,args,{env,windowsHide:true,shell:false,encoding:'utf8',timeout:10000,maxBuffer:8192});
  return r.status===0;
}
async function loopbackPort(){
  return new Promise((ok,bad)=>{
    const server=net.createServer();
    server.once('error',bad);
    server.listen(0,'127.0.0.1',()=>{
      const port=server.address().port;
      server.close(err=>err?bad(err):ok(port));
    });
  });
}
export function sealSynthetic(source,key){
  if(!Buffer.isBuffer(source)||!Buffer.isBuffer(key)||key.length!==32)throw Error('SYNTHETIC_ENVELOPE_INVALID');
  const iv=randomBytes(12),aad=Buffer.from(scope);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);
  const data=Buffer.concat([cipher.update(source),cipher.final()]);
  return {iv,tag:cipher.getAuthTag(),data,sha:sha(data)};
}
export function unsealSynthetic(envelope,key){
  if(!Buffer.isBuffer(key)||key.length!==32||!envelope||envelope.iv?.length!==12||envelope.tag?.length!==16||sha(envelope.data)!==envelope.sha)
    throw Error('SYNTHETIC_AUTH_DENIED');
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,envelope.iv);
    decipher.setAAD(Buffer.from(scope));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([decipher.update(envelope.data),decipher.final()]);
  }catch{throw Error('SYNTHETIC_AUTH_DENIED')}
}

export async function drill(){
  if(process.platform!=='win32'||!offlineOnly()||!required.every(f=>existsSync(join(binDir,f))))throw Error('SYNTHETIC_LOCAL_WINDOWS_ONLY');
  const base=mkdtempSync(join(tmpdir(),'pepday-synthetic-pg17-'));
  const data=join(base,'pgdata'),pwfile=join(base,'pwfile'),archive=join(base,'synthetic.dump');
  const extracted=join(base,'verified.dump'),log=join(base,'postgres.log');
  mkdirSync(data,{recursive:false});
  const secret=randomBytes(32).toString('base64url'),key=randomBytes(32);
  writeFileSync(pwfile,secret+'\n',{mode:0o600,flag:'wx'});
  let started=false,canDelete=true;
  const port=await loopbackPort();
  const env={...process.env,PATH:binDir+';'+process.env.PATH,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'qa_owner',PGPASSWORD:secret,PGDATABASE:'postgres',PGCONNECT_TIMEOUT:'3'};
  try{
    run('initdb.exe',['-D',data,'--username=qa_owner','--encoding=UTF8','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile='+pwfile,'--no-instructions'],{env,timeout:60000});
    rmSync(pwfile,{force:true});
    appendFileSync(join(data,'postgresql.conf'),
      "\nlisten_addresses = '127.0.0.1'\nport = "+port+"\nmax_connections = 12\n");
    run('pg_ctl.exe',['-D',data,'-l',log,'-w','-t','45','start'],{env,timeout:60000});
    started=true;
    const ps=(sql,db='postgres')=>run('psql.exe',['-X','-q','-v','ON_ERROR_STOP=1','-A','-t','-d',db,'-c',sql],{env});
    ps("CREATE SCHEMA qa; CREATE TABLE qa.events(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner text NOT NULL,code integer NOT NULL CHECK(code BETWEEN 1 AND 9)); ALTER TABLE qa.events ENABLE ROW LEVEL SECURITY; CREATE POLICY qa_by_owner ON qa.events USING(owner=current_user); INSERT INTO qa.events(owner,code) VALUES ('QA-ALPHA',2),('QA-BETA',3);");
    const original=ps("SELECT string_agg(id||':'||owner||':'||code,',' ORDER BY id) FROM qa.events;");
    if(original!=='1:QA-ALPHA:2,2:QA-BETA:3')throw Error('SYNTHETIC_SOURCE_MISMATCH');
    run('pg_dump.exe',['-Fc','-f',archive,'-d','postgres'],{env,timeout:60000});
    const plain=readFileSync(archive);
    const digest=sha(plain),envelope=sealSynthetic(plain,key);
    rmSync(archive,{force:true});
    const tampered={...envelope,data:Buffer.from(envelope.data)};
    tampered.data[0]^=1;
    let denied=false;try{unsealSynthetic(tampered,key)}catch{denied=true}
    if(!denied)throw Error('SYNTHETIC_TAMPER_ACCEPTED');
    const opened=unsealSynthetic(envelope,key);
    if(sha(opened)!==digest)throw Error('SYNTHETIC_ROUNDTRIP_MISMATCH');
    writeFileSync(extracted,opened,{mode:0o600,flag:'wx'});
    run('createdb.exe',['-T','template0','qa_restore'],{env});
    run('pg_restore.exe',['--exit-on-error','--no-owner','--no-privileges','-d','qa_restore',extracted],{env,timeout:60000});
    const restored=ps("SELECT string_agg(id||':'||owner||':'||code,',' ORDER BY id) FROM qa.events;",'qa_restore');
    const checks=ps("SELECT count(*)||','||(SELECT count(*) FROM pg_policies WHERE schemaname='qa' AND tablename='events')||','||(SELECT count(*) FROM pg_constraint WHERE conrelid='qa.events'::regclass AND contype IN ('p','c'))||','||(SELECT relrowsecurity FROM pg_class WHERE oid='qa.events'::regclass) FROM qa.events;",'qa_restore');
    if(restored!==original||checks!=='2,1,2,true')throw Error('SYNTHETIC_RESTORE_STRUCTURE_MISMATCH');
    const next=ps("INSERT INTO qa.events(owner,code) VALUES ('QA-GAMMA',4) RETURNING id;",'qa_restore');
    if(next!=='3')throw Error('SYNTHETIC_SEQUENCE_MISMATCH');
    return {status:'PASS_SYNTHETIC_ISOLATED',postgresVersion:'17.11',records:2,rls:true,policyCount:1,checks:2,sequenceRestored:true,
      aes256gcmRoundtrip:true,tamperDenied:true,loopbackOnly:true,remoteSupabaseTouched:false,realBackupProven:false};
  }finally{
    key.fill(0);
    if(started||runStatus('pg_ctl.exe',['-D',data,'status'],env)){
      if(!runStatus('pg_ctl.exe',['-D',data,'-w','-t','30','-m','immediate','stop'],env))canDelete=false;
    }
    if(canDelete)rmSync(base,{recursive:true,force:true,maxRetries:8,retryDelay:500});
    else throw Error('SYNTHETIC_STOP_FAILED_MANUAL_CLEANUP_REQUIRED');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2){console.error('NO_ARGUMENTS_ACCEPTED');process.exitCode=2}
  else{
    try{const result=await drill();console.log(JSON.stringify(result))}
    catch(e){console.error('SYNTHETIC_DRILL_FAILED '+String(e?.message||'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g,''));process.exitCode=1}
  }
}
