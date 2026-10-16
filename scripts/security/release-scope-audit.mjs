// Release scope audit is read-only and refuses to approve an entire DEV branch for PROD.
// Does not deploy, merge, fetch, contact providers or access credentials.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const approvedProdBase='fc12b0a6271882097671373c6bd5ea8587f87f81';
const prefix=(p,s)=>p===s||p.startsWith(s+'/');
const isDocumentation=p=>prefix(p,'docs')||prefix(p,'tests')||p==='AGENTS.md'||p==='README.md';

export function classifyReleasePath(p){
  if(typeof p!=='string'||!p||p.includes('\\')||p.includes('..')||p.startsWith('/'))throw Error('INVALID_PATH');
  if(isDocumentation(p))return 'documentation_or_tests';
  if(prefix(p,'supabase')||prefix(p,'infra')||prefix(p,'scripts/security'))return 'backend_or_infrastructure';
  if(prefix(p,'site/parceiros')||prefix(p,'site/admin/parceiros')||p.startsWith('src/partner-'))return 'partner_portal_or_finance';
  if(prefix(p,'site')||prefix(p,'src')||p==='app.js'||p==='index.html'||p.startsWith('scripts/build-'))return 'published_application';
  return 'other_requires_review';
}
export function auditReleasePaths(paths,{base=approvedProdBase,head='HEAD'}={}){
  const unique=[...new Set(paths)].sort();
  const byCategory={documentation_or_tests:[],backend_or_infrastructure:[],partner_portal_or_finance:[],published_application:[],other_requires_review:[]};
  for(const p of unique)byCategory[classifyReleasePath(p)].push(p);
  const publishableChanges=unique.filter(p=>classifyReleasePath(p)!=='documentation_or_tests');
  // Even a docs-only diff does NOT authorize deployment; exact release approval stays human.
  return {
    base,head,changedFiles:unique.length,
    counts:Object.fromEntries(Object.entries(byCategory).map(([k,v])=>[k,v.length])),
    blockedRuntimePaths:publishableChanges,
    deferredIntegrationTouchpoints:unique.filter(p=>!isDocumentation(p)&&/(?:whatsapp|partner-documents|parceiros\/documentos|parceiros\/fiscal|parceiros\/convite)/i.test(p)),
    verdict:publishableChanges.length?'BLOCKED_MIXED_RELEASE':'REVIEW_REQUIRED_NO_AUTO_DEPLOY',
    productionApproved:false,
    runInProduction:false
  };
}
export function getGitDiffNames({base=approvedProdBase,head='HEAD',cwd=process.cwd()}={}){
  // Two refs are resolved locally, never passed through a shell.
  const changes=execFileSync('git',['diff','--name-only','-z','--no-ext-diff',base,head,'--'],{cwd,encoding:'utf8',maxBuffer:4*1024*1024});
  return changes.split('\0').filter(Boolean);
}
export function reportCurrentRelease({base=approvedProdBase,head='HEAD',cwd=process.cwd()}={}){
  return auditReleasePaths(getGitDiffNames({base,head,cwd}),{base,head});
}

const isCli=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isCli){
  const args=process.argv.slice(2),gate=args.includes('--gate');
  if(args.some(x=>!['--gate','--report'].includes(x)))throw Error('UNKNOWN_ARGUMENT');
  const report=reportCurrentRelease();
  console.log(JSON.stringify(report,null,2));
  // For pipelines only, a changed application/backend must not pass silently.
  if(gate&&report.verdict==='BLOCKED_MIXED_RELEASE')process.exitCode=3;
}
