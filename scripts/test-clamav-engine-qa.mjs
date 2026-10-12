// Exercises the real engine using a deliberately tiny QA signature DB, NOT official live definitions.
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {runBinary,ClamAVScanner} from './security/clamav-scanner.mjs';
import {syntheticSampleBytes} from '../supabase/functions/partner-portal/quarantine-core.mjs';
if(!process.env.CLAMAV_BINARY)throw Error('CLAMAV_BINARY_REQUIRED');
const root=await mkdtemp(path.join(os.tmpdir(),'pepday-clamav-qa-'));
try{
  // Standard harmless antivirus test pattern; never a malicious executable or personal document.
  const marker=Buffer.from(['X5O!P%@AP[4','\\PZX54(P^)7CC)7}$','EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
  const db=path.join(root,'qa.ndb');await writeFile(db,`PepDay.QA.Eicar:0:*:${marker.toString('hex')}\n`,{mode:0o600});
  const clean=path.join(root,'clean.png'),infected=path.join(root,'eicar-test'),pdf=path.join(root,'eicar.pdf');
  await writeFile(clean,syntheticSampleBytes(),{mode:0o600});await writeFile(infected,marker,{mode:0o600});await writeFile(pdf,Buffer.concat([Buffer.from('%PDF-1.7\n'),marker,Buffer.from('\n%%EOF')]),{mode:0o600});
  const args=file=>['--database='+db,'--no-summary','--',file];
  assert.equal((await runBinary(process.env.CLAMAV_BINARY,args(clean))).code,0);
  assert.equal((await runBinary(process.env.CLAMAV_BINARY,args(infected))).code,1);
  assert.equal((await runBinary(process.env.CLAMAV_BINARY,args(pdf))).code,1);
  const scanner=new ClamAVScanner({binary:process.env.CLAMAV_BINARY,definitionsDir:root});assert.equal((await scanner.scan(clean)).status,'unavailable');
  const version=(await runBinary(process.env.CLAMAV_BINARY,['--version'])).output.trim().split('/')[0];
  const evidence={engine:version,cleanSynthetic:true,eicarDetected:true,embeddedEicarDetected:true,officialDefinitionsReady:false,missingDefinitionsBlocked:true,scope:'local_engine_qa_custom_test_signature',hostedWorker:false,realCollection:false};
  await mkdir(new URL('../test-output/',import.meta.url),{recursive:true});await writeFile(new URL('../test-output/clamav-engine-qa-20261012.json',import.meta.url),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await rm(root,{recursive:true,force:true})}
