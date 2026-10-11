import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {helpTopics,visibleTopics,normalized} from '../site/admin/admin-help-data.mjs';
const html=await readFile(new URL('../site/admin/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../site/admin/admin-help.css',import.meta.url),'utf8');
const js=await readFile(new URL('../site/admin/admin-help.mjs',import.meta.url),'utf8');
test('central is only rendered in authenticated dashboard, never login',()=>{
 const dashboard=html.indexOf('<section class="dashboard hidden" id="dashboard">');
 const help=html.indexOf('<section class="card admin-help" id="central-ajuda"');
 const dashboardEnd=html.indexOf('</section>\n</main>',help);
 assert.ok(dashboard>0&&help>dashboard&&dashboardEnd>help);
 assert.match(html,/<a class="admin-button" href="#central-ajuda">Central de Ajuda<\/a>/);
 assert.match(html,/<input id="helpSearch" type="search"/);
 assert.match(html,/<button id="helpPrint"/);
 assert.match(html,/admin-help\.mjs\?v=1/);
});
test('catalogue covers approved processes and clearly separates TEST/planned',()=>{
 for(const id of ['acesso','dashboard','cartao','promo','parceiros','financeiro-cadastro','comissoes','fiscal','contabilidade','convites','equipe','ajuda'])
  assert.ok(helpTopics.find(t=>t.id===id),'missing '+id);
 assert.ok(helpTopics.find(t=>t.id==='comissoes').status.includes('TEST'));
 assert.ok(helpTopics.find(t=>t.id==='convites').status.includes('não publicado'));
 assert.ok(helpTopics.find(t=>t.id==='contabilidade').status.includes('não publicado'));
 assert.ok(helpTopics.find(t=>t.id==='parceiros').steps.some(s=>s.includes('RASCUNHO')));
 assert.ok(helpTopics.find(t=>t.id==='cartao').note.includes('ainda'));
});
test('per-role visibility cannot reveal OWNER manuals to ADMIN/VIEWER',()=>{
 const viewer=visibleTopics({role:'VIEWER'});
 const admin=visibleTopics({role:'ADMIN'});
 const owner=visibleTopics({role:'OWNER'});
 assert.ok(owner.length>admin.length&&admin.length>viewer.length);
 assert.ok(!viewer.some(t=>['promo','financeiro-cadastro','comissoes','fiscal','equipe'].includes(t.id)));
 assert.ok(!admin.some(t=>['financeiro-cadastro','comissoes','fiscal','equipe'].includes(t.id)));
 assert.ok(owner.some(t=>t.id==='fiscal'));
 assert.deepEqual(visibleTopics({role:'UNKNOWN'}),[]);
});
test('search is case and accent insensitive, scoped by role',()=>{
 assert.equal(normalized('COMISSÕES'),'comissoes');
 assert.ok(visibleTopics({role:'OWNER',query:'ComiSSÕes'}).some(t=>t.id==='comissoes'));
 assert.ok(visibleTopics({role:'VIEWER',query:'cupom'}).every(t=>t.id!=='promo'));
 assert.ok(visibleTopics({role:'ADMIN',query:'WHATSAPP'}).some(t=>t.id==='convites'));
});
test('print and accessible details are local and preserve originals',()=>{
 assert.match(css,/@media print/);
 assert.match(css,/#central-ajuda,#central-ajuda \*/);
 assert.match(js,/window\.print\(\)/);
 assert.match(js,/afterprint/);
 assert.match(js,/document\.createElement/);
 assert.match(js,/\.textContent=/);
 assert.ok(!js.includes('innerHTML'));
});
