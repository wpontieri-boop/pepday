import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fiscalAccessMessage} from '../site/admin/parceiros/fiscal/access-message.mjs';
const file=name=>readFile(new URL('../site/admin/parceiros/fiscal/'+name,import.meta.url),'utf8');

test('missing session and revoked session explain the exact login recovery',()=>{
 for(const error of [{message:'AUTH_REQUIRED'},{name:'AuthSessionMissingError'},{status:401},{message:'Autenticação necessária',code:'42501'}]){
  const text=fiscalAccessMessage(error);
  assert.match(text,/Admin de homologação/);
  assert.match(text,/senha e 2FA/);
  assert.doesNotMatch(text,/transferência|repasse realizado/);
 }
 assert.match(fiscalAccessMessage({message:'PARTNER_SESSION_REVOKED',status:403,code:'42501'}),/revogada/);
});
test('Postgres 42501 preserves P3 business error message before generic HTTP 403',()=>{
 const expired=fiscalAccessMessage({code:'42501',message:'PARTNER_LOGIN_EXPIRED',status:403,accessStage:'finance'});
 assert.match(expired,/8 horas/);
 assert.match(expired,/“Sair”/);
 assert.match(expired,/novo login/);
 assert.doesNotMatch(expired,/permissão administrativa exigida/);
 const mfa=fiscalAccessMessage({code:'42501',message:'Autenticação em dois fatores necessária',status:403});
 assert.match(mfa,/autenticador/);
 const notAdmin=fiscalAccessMessage({code:'42501',message:'Acesso administrativo necessário',status:403});
 assert.match(notAdmin,/permissão administrativa/);
});
test('403 without known reason is not misdiagnosed as OWNER failure',()=>{
 const unknown=fiscalAccessMessage({status:403,code:'42501',message:'INTERNAL_PRIVATE_MESSAGE',accessStage:'finance'});
 assert.match(unknown,/acesso ao financeiro P3/);
 assert.match(unknown,/Não é possível concluir/);
 assert.doesNotMatch(unknown,/INTERNAL_PRIVATE_MESSAGE/);
 assert.doesNotMatch(unknown,/sua permissão no Admin/);
});
test('MFA, disabled gate and unexpected error have safe recovery instructions',()=>{
 assert.match(fiscalAccessMessage({message:'MFA_REQUIRED'}),/autenticador/);
 assert.match(fiscalAccessMessage({message:'PARTNER_FINANCE_DISABLED'}),/indisponível|desativado/);
 const unexpected=fiscalAccessMessage({message:'PRIVATE_DB_INTERNAL_CODE',accessStage:'admin'});
 assert.match(unexpected,/verificação de permissão administrativa/);
 assert.doesNotMatch(unexpected,/PRIVATE_DB_INTERNAL_CODE/);
});
test('fiscal login and retry UI maps only access errors and does not change OWNER step-up',async()=>{
 const html=await file('index.html'),js=await file('fiscal.mjs'),css=await file('fiscal.css');
 assert.match(html,/<a class="access-link" href="\/admin\/">Entrar no Admin \(senha \+ 2FA\)<\/a>/);
 assert.match(html,/id="retryAccess"/);
 assert.match(html,/fiscal\.mjs\?v=4/);
 assert.match(js,/access-message\.mjs\?v=2/);
 assert.match(js,/if\(target==='accessStatus'\)status\(fiscalAccessMessage\(e\),target\)/);
 assert.match(js,/accessStage=stage/);
 assert.match(js,/stage='finance';await load\(\)/);
 assert.match(js,/\$\('retryAccess'\)\.addEventListener\('click',init\)/);
 assert.match(js,/mfa\.challengeAndVerify/);
 assert.match(js,/admin_prepare_partner_finance/);
 assert.match(css,/access-link/);
});
