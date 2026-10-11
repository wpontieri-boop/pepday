import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fiscalAccessMessage} from '../site/admin/parceiros/fiscal/access-message.mjs';
const file=name=>readFile(new URL('../site/admin/parceiros/fiscal/'+name,import.meta.url),'utf8');

test('missing/expired session asks for Admin login instead of financial operation',()=>{
 for(const error of [{message:'AUTH_REQUIRED'},{name:'AuthSessionMissingError'},{status:401},{message:'PARTNER_SESSION_REVOKED'}]){
  const text=fiscalAccessMessage(error);
  assert.match(text,/Admin de homologação/);
  assert.match(text,/senha e 2FA/);
  assert.doesNotMatch(text,/transferência|repasse realizado/);
 }
});
test('missing MFA, denial and unexpected errors have distinct safe recovery instructions',()=>{
 assert.match(fiscalAccessMessage({message:'MFA_REQUIRED'}),/autenticador/);
 assert.match(fiscalAccessMessage({status:403}),/não autorizado/);
 const unexpected=fiscalAccessMessage({message:'PRIVATE_DB_INTERNAL_CODE'});
 assert.match(unexpected,/Não foi possível verificar/);
 assert.doesNotMatch(unexpected,/PRIVATE_DB_INTERNAL_CODE/);
});
test('fiscal login and retry UI maps only initial-access errors and does not change OWNER step-up',async()=>{
 const html=await file('index.html'),js=await file('fiscal.mjs'),css=await file('fiscal.css');
 assert.match(html,/<a class="access-link" href="\/admin\/">Entrar no Admin \(senha \+ 2FA\)<\/a>/);
 assert.match(html,/id="retryAccess"/);
 assert.match(html,/fiscal\.mjs\?v=2/);
 assert.match(html,/fiscal\.css\?v=2/);
 assert.match(js,/if\(target==='accessStatus'\)status\(fiscalAccessMessage\(e\),target\)/);
 assert.match(js,/\$\('retryAccess'\)\.addEventListener\('click',init\)/);
 assert.match(js,/mfa\.challengeAndVerify/);
 assert.match(js,/admin_prepare_partner_finance/);
 assert.match(css,/access-link/);
});
