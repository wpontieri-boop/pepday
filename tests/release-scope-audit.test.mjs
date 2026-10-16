import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  approvedProdBase,classifyReleasePath,auditReleasePaths,getGitDiffNames
} from '../scripts/security/release-scope-audit.mjs';

test('release baseline is exact currently approved PROD SHA',()=>{
  assert.equal(approvedProdBase,'fc12b0a6271882097671373c6bd5ea8587f87f81');
});

test('docs and tests alone never auto-authorize production',()=>{
  const result=auditReleasePaths(['docs/CURRENT-STATE.md','tests/smoke.test.mjs']);
  assert.equal(result.verdict,'REVIEW_REQUIRED_NO_AUTO_DEPLOY');
  assert.equal(result.productionApproved,false);
  assert.equal(result.runInProduction,false);
  assert.equal(result.changedFiles,2);
});

test('existing feature delta blocks blind promotion of DEV to PROD',()=>{
  const result=auditReleasePaths(['site/admin/parceiros/fiscal/index.html','docs/CURRENT-STATE.md','app.js']);
  assert.equal(result.verdict,'BLOCKED_MIXED_RELEASE');
  assert.deepEqual(result.blockedRuntimePaths,['app.js','site/admin/parceiros/fiscal/index.html']);
  assert.equal(result.counts.partner_portal_or_finance,1);
  assert.equal(result.counts.published_application,1);
});

test('WhatsApp and document touchpoints require explicit checks',()=>{
  const result=auditReleasePaths([
    'supabase/functions/meta-whatsapp-gateway/index.mjs',
    'site/parceiros/documentos/index.html',
    'site/parceiros/convite/index.html',
    'docs/operations/PEPDAY-CLOSURE-SCOPE-20261016.md'
  ]);
  assert.equal(result.verdict,'BLOCKED_MIXED_RELEASE');
  assert.equal(result.deferredIntegrationTouchpoints.length,3);
  assert.equal(result.counts.documentation_or_tests,1);
});

test('database migrations and scanner infrastructure are never quietly public-safe',()=>{
  assert.equal(classifyReleasePath('supabase/migrations/20261012013353_partner_portal_test.sql'),'backend_or_infrastructure');
  assert.equal(classifyReleasePath('infra/hostinger-security-test/compose.yaml'),'backend_or_infrastructure');
  assert.equal(classifyReleasePath('scripts/security/release-scope-audit.mjs'),'backend_or_infrastructure');
});

test('diff audit deduplicates and sorts filenames deterministically',()=>{
  const result=auditReleasePaths(['tests/b.test.mjs','app.js','tests/b.test.mjs']);
  assert.equal(result.changedFiles,2);
  assert.deepEqual(result.blockedRuntimePaths,['app.js']);
});

test('path traversal and unknown fields cannot bypass classification',()=>{
  for(const bad of ['', '../site/secret','/absolute/file','src\\secrets.mjs']) {
    assert.throws(()=>classifyReleasePath(bad),/INVALID_PATH/);
  }
  assert.equal(classifyReleasePath('random-unknown-file'),'other_requires_review');
});

test('real Git comparison is read-only and never auto-approves a branch',t=>{
  let list;
  try{list=getGitDiffNames()}catch{t.skip('baseline commit is unavailable in this checkout');return}
  const result=auditReleasePaths(list);
  assert.equal(result.productionApproved,false);
  assert.equal(result.runInProduction,false);
  if(list.some(p=>classifyReleasePath(p)!=='documentation_or_tests')){
    assert.equal(result.verdict,'BLOCKED_MIXED_RELEASE');
  }else{
    assert.equal(result.verdict,'REVIEW_REQUIRED_NO_AUTO_DEPLOY');
  }
  if(list.includes('supabase/functions/meta-whatsapp-gateway/index.mjs')){
    assert.ok(result.deferredIntegrationTouchpoints.includes('supabase/functions/meta-whatsapp-gateway/index.mjs'));
  }
});

test('CLI gate always requires human approval and never returns success',t=>{
  const cli=fileURLToPath(new URL('../scripts/security/release-scope-audit.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[cli,'--gate'],{encoding:'utf8',timeout:10000});
  if(result.status===1&&/fatal:|unknown revision/.test(result.stderr||'')){
    t.skip('Git checkout lacks the PROD baseline');return;
  }
  assert.ok([3,4].includes(result.status),'unexpected gate exit code '+result.status);
  const report=JSON.parse(result.stdout);
  assert.equal(report.productionApproved,false);
  assert.equal(report.runInProduction,false);
});
