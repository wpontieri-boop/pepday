import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,writeFile,readdir,chmod,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {PrivateDocumentWorker} from '../scripts/security/private-document-worker.mjs';
import {ClamAVScanner,sha256,runBinary} from '../scripts/security/clamav-scanner.mjs';
import {syntheticSampleBytes} from '../supabase/functions/partner-portal/quarantine-core.mjs';
const bytes=()=>syntheticSampleBytes();
async function fixture(t,options={}){
  const parent=await mkdtemp(path.join(os.tmpdir(),'pepday-doc-qa-'));t.after(()=>rm(parent,{recursive:true,force:true}));
  let clock=Date.now();const now=()=>clock;
  const scanner={scan:async file=>{const b=await import('node:fs/promises').then(fs=>fs.readFile(file));return {status:'clean',engine:'clamav',engineVersion:'ClamAV 1.5.3',definitionsVersion:'1',definitionsAt:now(),sha256:sha256(b),scannedAt:now()}}};
  const worker=await new PrivateDocumentWorker({root:path.join(parent,'private'),scanner,authorize:async(c,o)=>c===o,now,...options}).init();
  return {worker,scanner,parent,now,tick:ms=>clock+=ms,put:(extra={})=>worker.put({context:'QA-A',owner:'QA-A',bytes:bytes(),mime:'image/png',synthetic:true,...extra})};
}
test('private staging and clean files use 0700/0600; capability is owner-bound and single-use',async t=>{
  const f=await fixture(t),r=await f.put();assert.equal(r.state,'clean');assert.equal(r.realCollection,false);
  if(process.platform==='win32'){
    // O Windows não expõe ACLs como bits POSIX em fs.stat; a prova 0700/0600 permanece obrigatória em Linux.
    const source=await readFile(new URL('../scripts/security/private-document-worker.mjs',import.meta.url),'utf8');
    assert.match(source,/mkdir\(this\.#root,\{mode:0o700\}\)/);
    assert.match(source,/writeFile\(file,copy,\{mode:0o600,flag:'wx'\}\)/);
  }else{
    assert.equal((await stat(path.join(f.parent,'private'))).mode&0o777,0o700);
    assert.equal((await stat(path.join(f.parent,'private','clean',r.id))).mode&0o777,0o600);
  }
  const link=await f.worker.capability({context:'QA-A',owner:'QA-A',id:r.id});
  await assert.rejects(f.worker.read({context:'QA-B',owner:'QA-B',token:link.token}),/DENIED/);
  const data=await f.worker.read({context:'QA-A',owner:'QA-A',token:link.token});assert.deepEqual(new Uint8Array(data.bytes),bytes());assert.equal(data.headers['Cache-Control'],'no-store');
  await assert.rejects(f.worker.read({context:'QA-A',owner:'QA-A',token:link.token}),/DENIED/);
  assert.ok(!JSON.stringify(f.worker.audit()).includes(link.token));assert.ok(!JSON.stringify(f.worker.audit()).includes('QA-A'));
});
test('real collection, invalid MIME/magic, oversized and unauthorized input denied before scanner',async t=>{
  const f=await fixture(t);let calls=0;f.scanner.scan=async()=>{calls++;throw Error('must not scan')};
  for(const extra of [{synthetic:false},{owner:'real-name'},{context:'QA-B'},{mime:'application/pdf'},{bytes:new Uint8Array(5242881)},{bytes:new Uint8Array([1,2,3])}])await assert.rejects(f.put(extra));
  assert.equal(calls,0);assert.deepEqual(await readdir(path.join(f.parent,'private','staging')),[]);
});
test('infected, unavailable, wrong digest/engine, future/stale scan and definitions deny promotion',async t=>{
  for(const patch of [{status:'infected'},{status:'unavailable'},{sha256:'0'.repeat(64)},{engine:'fake'},{scannedAt:0},{scannedAt:Date.now()+900000},{definitionsAt:0},{definitionsAt:Date.now()+900000},{definitionsVersion:undefined}]){
    const f=await fixture(t);const original=f.scanner.scan;f.scanner.scan=async file=>({...await original(file),...patch});
    const r=await f.put();assert.equal(r.state,'rejected');assert.deepEqual(await readdir(path.join(f.parent,'private','clean')),[]);
    await assert.rejects(f.worker.capability({context:'QA-A',owner:'QA-A',id:r.id}),/DENIED/);
  }
});
test('scanner exception, tampering while scanning and post-scan revocation fail closed',async t=>{
  const f=await fixture(t);f.scanner.scan=async()=>{throw Error('engine offline')};assert.equal((await f.put()).state,'rejected');
  const g=await fixture(t);const original=g.scanner.scan;g.scanner.scan=async file=>{const proof=await original(file);await writeFile(file,Buffer.from('tampered'));return proof};assert.equal((await g.put()).state,'rejected');
  let access=true;const h=await fixture(t,{authorize:async()=>access});const old=h.scanner.scan;h.scanner.scan=async file=>{const proof=await old(file);access=false;return proof};assert.equal((await h.put()).state,'rejected');
});
test('quarantine cannot be downloaded during scan; expired scan cannot publish; cleanup removes bytes',async t=>{
  const f=await fixture(t);const original=f.scanner.scan;let blocked=false;
  f.scanner.scan=async file=>{const id=path.basename(file);await assert.rejects(f.worker.capability({context:'QA-A',owner:'QA-A',id}),/DENIED/);blocked=true;const proof=await original(file);f.tick(120001);return proof};
  assert.equal((await f.put()).state,'rejected');assert.equal(blocked,true);await f.worker.expire();assert.deepEqual(await readdir(path.join(f.parent,'private','staging')),[]);
});
test('links expire, files expire and removal invalidates links',async t=>{
  const f=await fixture(t),r=await f.put(),link=await f.worker.capability({context:'QA-A',owner:'QA-A',id:r.id});f.tick(30001);
  await assert.rejects(f.worker.read({context:'QA-A',owner:'QA-A',token:link.token}),/DENIED/);f.tick(90000);await f.worker.expire();assert.deepEqual(await readdir(path.join(f.parent,'private','clean')),[]);
  const g=await fixture(t),r2=await g.put(),l2=await g.worker.capability({context:'QA-A',owner:'QA-A',id:r2.id});
  await assert.rejects(g.worker.remove({context:'QA-B',owner:'QA-B',id:r2.id}),/DENIED/);
  await g.worker.remove({context:'QA-A',owner:'QA-A',id:r2.id});await assert.rejects(g.worker.read({context:'QA-A',owner:'QA-A',token:l2.token}),/DENIED/);
});
test('file hash is checked again on download and worker cannot adopt shared/existing root',async t=>{
  const f=await fixture(t),r=await f.put(),l=await f.worker.capability({context:'QA-A',owner:'QA-A',id:r.id});
  await writeFile(path.join(f.parent,'private','clean',r.id),'different');await assert.rejects(f.worker.read({context:'QA-A',owner:'QA-A',token:l.token}),/DENIED/);
  await assert.rejects(new PrivateDocumentWorker({root:path.join(f.parent,'private'),scanner:f.scanner}).init(),/EEXIST/);
});
test('real ClamAV adapter denies absent definitions and executable, without fabricated PASS',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.parent,'sample'),bytes());
  const scanner=new ClamAVScanner({binary:'/nonexistent/clamav',definitionsDir:f.parent});
  assert.equal((await scanner.scan(path.join(f.parent,'sample'))).status,'unavailable');
  await assert.rejects(runBinary('/nonexistent/clamav',[]),/UNAVAILABLE/);
});
test('subprocess timeout and excessive output are bounded',async()=>{
  await assert.rejects(runBinary(process.execPath,['-e','setTimeout(()=>{},1000)'],{timeoutMs:20}),/TIMEOUT/);
  await assert.rejects(runBinary(process.execPath,['-e',"process.stdout.write('x'.repeat(100000))"]),/OUTPUT_LIMIT/);
});
test('adapter enforces freshness and official DB options; mocked receipt is clearly unit-only',async t=>{
  const f=await fixture(t),file=path.join(f.parent,'sample.png'),binary=path.join(f.parent,'engine');await writeFile(file,bytes());
  const current=f.now(),header=stamp=>`ClamAV-VDB:date:123:1:1:unused:unused:QA:${Math.floor(stamp/1000)}`;
  await writeFile(binary,`#!${process.execPath}\nif(process.argv.includes('--version'))console.log('ClamAV 1.5.3');else {if(!process.argv.includes('--official-db-only=yes')||!process.argv.includes('--fail-if-cvd-older-than=2'))process.exit(2);console.log(process.argv.at(-1)+': OK')}\n`);await chmod(binary,0o700);
  const scanner=new ClamAVScanner({binary,definitionsDir:f.parent,now:f.now});
  await writeFile(path.join(f.parent,'daily.cvd'),header(current-49*3600000));assert.equal((await scanner.scan(file)).reason,'DEFINITIONS_STALE');
  await writeFile(path.join(f.parent,'daily.cvd'),header(current));
  const proof=await scanner.scan(file);
  if(process.platform==='win32'){
    // Script de teste com shebang POSIX não é executável via spawn(shell:false) no Windows; negar é correto.
    assert.equal(proof.status,'unavailable');
  }else{
    assert.equal(proof.status,'clean');assert.equal(proof.sha256,sha256(bytes()));
  }
  await writeFile(path.join(f.parent,'daily.cvd'),'invalid');assert.equal((await scanner.scan(file)).status,'unavailable');
});
test('download rechecks permission after reading bytes; revoked actor receives no data',async t=>{
  let calls=0,revoking=false;const f=await fixture(t,{authorize:async()=>!revoking||++calls===1}),r=await f.put();
  const link=await f.worker.capability({context:'QA-A',owner:'QA-A',id:r.id});revoking=true;
  await assert.rejects(f.worker.read({context:'QA-A',owner:'QA-A',token:link.token}),/DENIED/);
});
test('cleanup cannot remove a directory that this worker did not create',async t=>{
  const f=await fixture(t),other=new PrivateDocumentWorker({root:f.parent,scanner:f.scanner});
  await assert.rejects(other.dispose(),/NOT_OWNED/);assert.equal((await stat(f.parent)).isDirectory(),true);
  await f.worker.dispose();await assert.rejects(f.worker.dispose(),/NOT_OWNED/);
});
