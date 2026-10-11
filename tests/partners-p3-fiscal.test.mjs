import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const file=path=>readFile(new URL(path,root),'utf8');
test('fiscal TEST only and OWNER step-up uses existing tickets',async()=>{
 const js=await file('site/admin/parceiros/fiscal/fiscal.mjs');
 assert.match(js,/config\.environment==='test'/);
 for(const fn of ['admin_partner_fiscal','admin_prepare_partner_finance','admin_partner_fiscal_action'])assert.ok(js.includes(fn));
 assert.match(js,/mfa\.challengeAndVerify/);
 assert.match(js,/details\.can_manage/);
});
test('document selection is initially empty, required, never implicitly chosen',async()=>{
 const html=await file('site/admin/parceiros/fiscal/index.html');
 const js=await file('site/admin/parceiros/fiscal/fiscal.mjs');
 assert.match(html,/<select id="documentType" required>/);
 assert.match(html,/<option value="" selected disabled>Escolha o tipo do documento<\/option>/);
 assert.match(html,/id="documentSubmit" disabled/);
 assert.match(js,/function resetDocType\(\)/);
 assert.match(js,/\$\('documentType'\)\.value=''/);
 assert.match(js,/\$\('documentType'\)\.addEventListener\('change',syncDocSelection\)/);
 assert.match(js,/!type\|\|!fileReady/);
});
test('private storage contract and no real money transfer',async()=>{
 const edge=await file('supabase/functions/partner-documents/document-core.mjs');
 assert.match(edge,/partner-documents-test/);
 assert.match(edge,/MAX=5242880/);
 assert.match(edge,/TEST_URL/);
 assert.match(edge,/admin_partner_document_access/);
 assert.match(edge,/partner_document_complete/);
 const js=await file('site/admin/parceiros/fiscal/fiscal.mjs');
 assert.doesNotMatch(js,/service_role|SUPABASE_SERVICE_ROLE_KEY/);
 assert.doesNotMatch(js,/transferFunds|pixTransfer|mercado-pago-checkout/);
});
test('no legal retention defaults and database contract snapshot is non-migratory',async()=>{
 const js=await file('site/admin/parceiros/fiscal/fiscal.mjs');
 assert.match(js,/months\)result\[type\]\.months=months/);
 assert.match(js,/Pendente/);
 const sql=await file('docs/operations/P3-FISCAL-FUNCTIONS-TEST-SNAPSHOT.sql');
 assert.match(sql,/NOT A MIGRATION/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.admin_partner_fiscal_action/);
});
test('fiscal TEST checkbox has explicit label grid, avoiding unsupported implicit :has layouts',async()=>{
 const html=await file('site/admin/parceiros/fiscal/index.html');
 const css=await file('site/admin/parceiros/fiscal/fiscal.css');
 const js=await file('site/admin/parceiros/fiscal/fiscal.mjs');
 assert.match(html,/<label class="fiscal-checkbox-row"><input id="fiscalRequired" type="checkbox"><span>Exigir documento fiscal/);
 assert.match(html,/<label class="fiscal-checkbox-row"><input type="checkbox" id="noWithholding"><span>Sem retenção/);
 assert.match(html,/fiscal\.css\?v=4/);
 assert.match(html,/fiscal\.mjs\?v=5/);
 assert.match(js,/checkbox\.className='fiscal-checkbox-row'/);
 assert.match(js,/caption\.textContent='Parecer jurídico\/contábil validado'/);
 assert.match(css,/\.fiscal-checkbox-row\{display:grid!important;grid-template-columns:22px minmax\(0,1fr\)!important/);
 assert.match(css,/\.fiscal-checkbox-row>input\[type=checkbox\]/);
 assert.match(css,/\.dash-head a\{display:inline-flex/);
});
