import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {helpTopics,visibleTopics,normalized} from '../site/admin/admin-help-data.mjs';
const html=await readFile(new URL('../site/admin/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../site/admin/admin-help.css',import.meta.url),'utf8');
const js=await readFile(new URL('../site/admin/admin-help.mjs',import.meta.url),'utf8');
const adminJs=await readFile(new URL('../site/admin/admin.mjs',import.meta.url),'utf8');
test('Central de Ajuda has a separate hidden view, not a long dashboard footer',()=>{
 const dashboard=html.indexOf('<section class="dashboard hidden" id="dashboard">');
 const helpPage=html.indexOf('<section class="admin-help-view hidden" id="adminHelpView"');
 const help=html.indexOf('<section class="card admin-help" id="central-ajuda"');
 const dashboardEnd=html.indexOf('</section>\n\n  <section class="admin-help-view hidden"');
 assert.ok(dashboard>0&&dashboardEnd>dashboard&&helpPage>dashboardEnd&&help>helpPage);
 assert.match(html,/<button class="admin-button" type="button" id="adminHelpShortcut">Central de Ajuda<\/button>/);
 assert.match(html,/id="adminHelpBack">← Voltar ao painel<\/button>/);
 assert.match(html,/<input id="helpSearch" type="search"/);
 assert.match(html,/<button id="helpPrint"/);
 assert.match(html,/admin-help\.mjs\?v=5/);
 assert.match(html,/admin\.mjs\?v=39/);
 assert.match(html,/admin-help\.css\?v=2/);
});
test('catalogue covers approved processes and clearly separates TEST/planned',()=>{
 for(const id of ['acesso','dashboard','cartao','promo','parceiros','financeiro-cadastro','comissoes','fiscal','contabilidade','convites','equipe','ajuda'])
  assert.ok(helpTopics.find(t=>t.id===id),'missing '+id);
 assert.ok(helpTopics.find(t=>t.id==='comissoes').status.includes('TEST'));
 assert.ok(helpTopics.find(t=>t.id==='convites').status.includes('envio real não publicado'));
 assert.ok(helpTopics.find(t=>t.id==='contabilidade').status.includes('TEST'));
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

test('Help has own history entry and guarded view, not new auth or signOut',()=>{
 assert.match(js,/new URL\(location\.href\)\.searchParams\.get\('view'\)==='ajuda'/);
 assert.match(js,/authenticated=\(\)=>document\.documentElement\.dataset\.pepdayAdminAuthenticated==='true'/);
 assert.match(js,/history\.pushState/);
 assert.match(js,/history\.back\(\)/);
 assert.match(js,/adminHelpShortcut/);
 assert.match(js,/adminHelpBack/);
 assert.match(js,/window\.addEventListener\('popstate',syncHelpView\)/);
 assert.doesNotMatch(js,/signOut|client\.auth|createClient/);
 assert.match(adminJs,/document\.documentElement\.dataset\.pepdayAdminAuthenticated='true'/);
 assert.match(adminJs,/delete document\.documentElement\.dataset\.pepdayAdminAuthenticated/);
 assert.match(css,/#adminHelpView\{display:block!important/);
});
test('successful Admin MFA clears challenge state before navigating to Help',()=>{
 const ready=adminJs.slice(adminJs.indexOf('async function openDashboard'),adminJs.indexOf('async function resetAdminUi'));
 assert.match(ready,/authStage\('dashboard'\);/);
 assert.match(adminJs,/stage==='dashboard'\)&&history\.state\?\.pepdayAdminTotp/);
 assert.match(adminJs,/currentAuthStage==='mfa-challenge'&&!event\.state\?\.pepdayAdminTotp/);
});
test('authenticated admin finishes MFA state and keeps session on Help/back navigation (simulated auth)',async()=>{
 const auth=adminJs.slice(adminJs.indexOf('function authStage(stage='),adminJs.indexOf('async function adminContextForSession'));
 const dashboard=adminJs.slice(adminJs.indexOf('async function openDashboard('),adminJs.indexOf('async function resetAdminUi'));
 const history={state:{},changes:[],pushState(state){this.state=state;this.changes.push('push')},replaceState(state){this.state=state;this.changes.push('replace')}};
 const mock={history,location:{href:'https://homologacao.pepday.com.br/admin/'},authAttemptVersion:1,document:{documentElement:{dataset:{}}}};
 runInNewContext(`
  let currentAuthStage='login',adminContext=null;
  const hide=()=>{},authStatus=()=>{},attemptIsCurrent=()=>true,applyAdminPermissions=()=>{},loadMetrics=async()=>{};
  async function adminContextForSession(){return {aal:'aal2'}}
  ${auth}
  ${dashboard}
  globalThis.api={authStage,openDashboard,getStage:()=>currentAuthStage};
 `,mock);
 mock.api.authStage('mfa-challenge');
 assert.equal(mock.api.getStage(),'mfa-challenge');
 assert.equal(history.state.pepdayAdminTotp,true);
 await mock.api.openDashboard();
 assert.equal(mock.api.getStage(),'dashboard');
 assert.equal(history.state.pepdayAdminTotp,undefined);
 assert.deepEqual(history.changes,['push','replace']);
 const shouldLogout=mock.api.getStage()==='mfa-challenge'&&!null?.pepdayAdminTotp;
 assert.equal(shouldLogout,false,'Back/Help navigation after successful MFA must not trigger logout');
});

test('Help denied while logged out; after AAL2 it opens and returns without navigating out (VM)',()=>{
 const source=js.slice(js.indexOf("const page=document.getElementById('adminHelpView');"),js.indexOf("const count=document.getElementById('helpStatus');"));
 const handlers=new Map(),cls=()=>({hidden:true,toggle(name,hidden){if(name==='hidden')this.hidden=hidden;}});
 const page={classList:cls()},dashboard={classList:cls()},roleNode={textContent:'OWNER'};
 const authData={pepdayAdminAuthenticated:undefined};
 const root={dataset:authData};
 const nodes={adminHelpView:page,dashboard,adminRole:roleNode,
   adminHelpShortcut:{addEventListener:(event,fn)=>handlers.set('open',fn)},
   adminHelpBack:{addEventListener:(event,fn)=>handlers.set('back',fn)}};
 let address='https://homologacao.pepday.com.br/admin/', oldAddress=address,back=0;
 const history={state:{},pushState(state,unused,url){this.state=state;address=String(url)},replaceState(state,unused,url){this.state=state;address=String(url)},
   back(){back++;address=oldAddress;this.state={};listeners.popstate()}};
 const listeners={};
 let renders=0;
 const document={documentElement:root,getElementById:id=>nodes[id]};
 const sandbox={document,history,URL,roleNode,role:()=>roleNode.textContent,location:{get href(){return address}},window:{scrollTo(){},addEventListener(name,fn){listeners[name]=fn}},MutationObserver:class{observe(){}},render(){renders++}};
 runInNewContext(source.replace('const authenticated=',"const authenticated="),sandbox);
 handlers.get('open')();
 assert.equal(page.classList.hidden,true,'unauthenticated Help never shows');
 assert.equal(address,oldAddress,'unauthenticated click cannot modify URL');
 authData.pepdayAdminAuthenticated='true';
 sandbox.syncHelpView?.();
 handlers.get('open')();
 assert.equal(page.classList.hidden,false);
 assert.equal(dashboard.classList.hidden,true);
 assert.match(address,/view=ajuda/);
 handlers.get('back')();
 assert.equal(back,1);
 assert.equal(page.classList.hidden,true);
 assert.equal(dashboard.classList.hidden,false);
 assert.equal(address,oldAddress);
 authData.pepdayAdminAuthenticated=undefined;
 sandbox.syncHelpView?.();
 assert.equal(page.classList.hidden,true);
});
