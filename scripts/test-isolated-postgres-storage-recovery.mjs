// Actual PostgreSQL/PGlite cluster restore + object-file restore, exclusively synthetic and local.
import {pathToFileURL} from 'node:url';import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
import {syntheticSampleBytes} from '../supabase/functions/partner-portal/quarantine-core.mjs';
import {sealRecovery,openRecovery} from './security/isolated-recovery.mjs';import {sha256} from './security/clamav-scanner.mjs';
if(!process.env.PGLITE_MODULE)throw Error('PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const root=await mkdtemp(path.join(os.tmpdir(),'pepday-restore-qa-'));let source,target;const key=randomBytes(32);
try{
  const objects=[{id:'QA-object-1',owner:'QA-A',mime:'image/png',bytes:Buffer.from(syntheticSampleBytes())},{id:'QA-object-2',owner:'QA-B',mime:'application/pdf',bytes:Buffer.from('%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\n%%EOF')}];
  source=await PGlite.create();
  await source.exec(`create role qa_a;create role qa_b;create role qa_anon;
    create schema qa_private;revoke all on schema qa_private from public;
    create table qa_private.documents(id text primary key,owner text not null,sha256 text not null);
    alter table qa_private.documents enable row level security;
    grant usage on schema qa_private to qa_a,qa_b;grant select on qa_private.documents to qa_a,qa_b;
    create policy own_only on qa_private.documents for select to qa_a,qa_b using(owner=current_user);
    insert into qa_private.documents values('QA-object-1','qa_a','${sha256(objects[0].bytes)}'),('QA-object-2','qa_b','${sha256(objects[1].bytes)}');`);
  const compareSQL=`select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(d) order by id) from qa_private.documents d),
    'columns',(select jsonb_agg(to_jsonb(c) order by ordinal_position) from information_schema.columns c where table_schema='qa_private'),
    'acl',(select relacl::text from pg_class where oid='qa_private.documents'::regclass),
    'rls',(select relrowsecurity from pg_class where oid='qa_private.documents'::regclass),
    'policy',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='qa_private'),
    'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid='qa_private.documents'::regclass)) evidence`;
  const baseline=(await source.query(compareSQL)).rows[0].evidence;
  const database=Buffer.from(await (await source.dumpDataDir()).arrayBuffer());
  const bundle=sealRecovery({database,objects,synthetic:true,key});
  const archive=path.join(root,'snapshot.enc');await writeFile(archive,bundle.ciphertext,{mode:0o600,flag:'wx'});assert.equal((await stat(archive)).mode&0o777,0o600);
  const restored=openRecovery({...bundle,ciphertext:await readFile(archive)},key,{synthetic:true});
  target=await PGlite.create({loadDataDir:new Blob([restored.database])});
  assert.deepEqual((await target.query(compareSQL)).rows[0].evidence,baseline);
  await mkdir(path.join(root,'objects'),{mode:0o700});
  for(const o of restored.objects){const file=path.join(root,'objects',o.id);await writeFile(file,o.bytes,{mode:0o600,flag:'wx'});assert.equal(sha256(await readFile(file)),o.sha256);assert.equal((await stat(file)).mode&0o777,0o600)}
  await target.exec('set role qa_a');assert.deepEqual((await target.query('select id from qa_private.documents')).rows,[{id:'QA-object-1'}]);
  await assert.rejects(target.exec("insert into qa_private.documents values('QA-write','qa_a','x')"));
  await target.exec('reset role;set role qa_b');assert.deepEqual((await target.query('select id from qa_private.documents')).rows,[{id:'QA-object-2'}]);
  await target.exec('reset role;set role qa_anon');await assert.rejects(target.query('select * from qa_private.documents'));await target.exec('reset role');
  const tampered={...bundle,ciphertext:Buffer.from(bundle.ciphertext)};tampered.ciphertext[0]^=1;
  assert.throws(()=>openRecovery(tampered,key,{synthetic:true}),/DENIED/);assert.throws(()=>openRecovery(bundle,key,{synthetic:true,target:'production'}),/DENIED/);
  const evidence={scope:'local_postgresql_storage_synthetic',postgresVersion:(await target.query('select version() v')).rows[0].v,structuresEqual:true,rows:2,objectsRestored:2,hashesEqual:true,aclEqual:true,rlsCrossOwnerDenied:true,anonymousDenied:true,writeDenied:true,encrypted:true,tamperingDenied:true,productionDenied:true,remoteSupabaseBackup:false,durableSchedule:false};
  await mkdir(new URL('../test-output/',import.meta.url),{recursive:true});await writeFile(new URL('../test-output/security-recovery-20261012.json',import.meta.url),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{key.fill(0);await source?.close();await target?.close();await rm(root,{recursive:true,force:true})}
