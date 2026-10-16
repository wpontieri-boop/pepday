import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backupPreflight, inspectPostgres17, postgres17} from '../scripts/security/backup-test-preflight.mjs';
const manifest = JSON.parse(readFileSync(new URL('../infra/hostinger-security-test/backup-target.test.json',import.meta.url)));
const readyTools = {pg_dump:true, pg_restore:true, psql:true};

test('reconhece somente utilitários PostgreSQL 17, inclusive CRLF Windows', () => {
  for (const tool of Object.keys(readyTools)) {
    assert.equal(postgres17(tool,`${tool} (PostgreSQL) 17.6\r\n`),true);
    for (const version of ['16.9','18.1','170.1','17.x'])
      assert.equal(postgres17(tool,`${tool} (PostgreSQL) ${version}`),false);
    assert.equal(postgres17(tool,`untrusted\n${tool} (PostgreSQL) 17.6`),false);
  }
});
test('inventário executa apenas --version, sem shell, com timeout e sem vazar saída', () => {
  const calls=[];
  const state=inspectPostgres17((command,args,opts)=>{
    calls.push(command); assert.deepEqual(args,['--version']);
    assert.equal(opts.shell,false); assert.equal(opts.timeout,5000);
    return {status:0,stdout:`${command} (PostgreSQL) 17.6\r\n`};
  });
  assert.deepEqual(calls,Object.keys(readyTools)); assert.deepEqual(state,readyTools);
  assert.deepEqual(inspectPostgres17(()=>{throw Error('private detail')}),
    {pg_dump:false,pg_restore:false,psql:false});
});
test('custódia PASS e ferramentas não autorizam dump ou restore', () => {
  const report=backupPreflight(manifest,readyTools);
  assert.equal(report.executionAllowed,false);
  assert.ok(report.blockers.includes('ISOLATED_RESTORE_TARGET_NOT_AUTHORIZED'));
  assert.ok(report.blockers.includes('PROTECTED_TEST_CREDENTIALS_NOT_VERIFIED'));
  assert.ok(!report.blockers.includes('CUSTODY_UNCONFIRMED'));
  const forged=structuredClone(manifest);
  for(const key of Object.keys(forged.activation_gates))forged.activation_gates[key]=true;
  assert.deepEqual(backupPreflight(forged,readyTools),report);
});
test('PROD, fonte indefinida e flags de execução são sinalizadas', () => {
  for(const id of ['oslefjmwfnddxlotalxu',null,'central-postgres']) {
    const bad=structuredClone(manifest);bad.source.project_id=id;
    assert.ok(backupPreflight(bad).blockers.includes('INVALID_TEST_SCOPE'));
  }
  const bad=structuredClone(manifest);bad.database_export_enabled=true;
  assert.ok(backupPreflight(bad).blockers.includes('EXECUTION_FLAG_NOT_OFF'));
  assert.equal(backupPreflight(null).executionAllowed,false);
});
test('política sem criptografia, bytes Storage ou Drive privado é bloqueada', () => {
  const bad=structuredClone(manifest);
  bad.security.encryption_required_before_upload=false;
  bad.source.include_storage_object_bytes=false;bad.destination.shared=true;
  const report=backupPreflight(bad,readyTools);
  for(const code of ['UNSAFE_BACKUP_POLICY','STORAGE_BYTES_REQUIRED','INVALID_PRIVATE_DRIVE_DESTINATION'])
    assert.ok(report.blockers.includes(code));
});
test('ferramenta ausente ou erro de processo não passa compatibilidade', () => {
  const runtime=inspectPostgres17(()=>({status:1,stdout:'pg_dump (PostgreSQL) 17.6'}));
  const report=backupPreflight(manifest,runtime);
  assert.equal(report.blockers.filter(x=>x.startsWith('POSTGRES17_')).length,3);
});
