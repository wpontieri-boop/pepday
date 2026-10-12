import {helpVersion,helpTopics,visibleTopics} from './admin-help-data.mjs?v=1';
const root=document.getElementById('central-ajuda');
const search=document.getElementById('helpSearch');
const list=document.getElementById('helpList');
const roleNode=document.getElementById('adminRole');
const page=document.getElementById('adminHelpView');
const dashboard=document.getElementById('dashboard');
const authenticated=()=>document.documentElement.dataset.pepdayAdminAuthenticated==='true';
const helpRequested=()=>new URL(location.href).searchParams.get('view')==='ajuda';
function syncHelpView(){
 const allowed=authenticated()&&!!role();
 const show=allowed&&helpRequested();
 page?.classList.toggle('hidden',!show);
 if(allowed)dashboard?.classList.toggle('hidden',show);
 // Never reveal Help merely because an unauthenticated URL requests it.
 if(show)render();
}
function moveToHelp(){
 if(!authenticated()||!role())return;
 const url=new URL(location.href);
 url.searchParams.set('view','ajuda');
 history.pushState({...history.state,pepdayHelpView:true},'',url);
 syncHelpView();
 window.scrollTo(0,0);
}
function moveToDashboard(){
 if(!authenticated())return;
 if(history.state?.pepdayHelpView){history.back();return;}
 const url=new URL(location.href);
 url.searchParams.delete('view');
 history.replaceState({...history.state,pepdayHelpView:false},'',url);
 syncHelpView();
 window.scrollTo(0,0);
}
document.getElementById('adminHelpShortcut')?.addEventListener('click',moveToHelp);
document.getElementById('adminHelpBack')?.addEventListener('click',moveToDashboard);
window.addEventListener('popstate',syncHelpView);
new MutationObserver(syncHelpView).observe(document.documentElement,{attributes:true,attributeFilter:['data-pepday-admin-authenticated']});
const count=document.getElementById('helpStatus');
const clear=document.getElementById('helpClear');
const printButton=document.getElementById('helpPrint');
let restore=null;

function role(){
 const label=String(roleNode?.textContent||'').trim().toUpperCase();
 return ['OWNER','ADMIN','VIEWER'].includes(label)?label:null;
}
function element(tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=text;
 return node;
}
function render(){
 if(!root||!list||!count)return;
 const currentRole=role();
 list.replaceChildren();
 if(!currentRole){count.textContent='Entre no painel para consultar os guias do seu perfil.';return;}
 const filtered=visibleTopics({role:currentRole,query:search?.value||''});
 count.textContent=filtered.length+' de '+helpTopics.filter(topic=>topic.roles.includes(currentRole)).length+' guias disponíveis · Revisão '+helpVersion;
 for(const topic of filtered){
  const details=element('details','help-topic');
  details.dataset.helpTopic=topic.id;
  const summary=element('summary');
  const title=element('strong','help-topic-title',topic.title);
  const metadata=element('span','help-topic-meta',topic.category+' · '+topic.status);
  summary.append(title,metadata);details.append(summary);
  const steps=element('ol','help-steps');
  for(const step of topic.steps)steps.append(element('li','',step));
  details.append(steps,element('p','help-note','Atenção: '+topic.note));
  list.append(details);
 }
 if(!filtered.length)list.append(element('p','help-empty','Nenhum guia encontrado. Tente outro termo.'));
}
search?.addEventListener('input',render);
clear?.addEventListener('click',()=>{search.value='';render();search.focus();});
new MutationObserver(()=>{render();syncHelpView()}).observe(roleNode,{childList:true,characterData:true,subtree:true});
printButton?.addEventListener('click',()=>{
 if(!role())return;
 const value=search?.value||'';
 const opened=[...list.querySelectorAll('details[open]')].map(item=>item.dataset.helpTopic);
 if(search){search.value='';render();}
 for(const detail of list.querySelectorAll('details'))detail.open=true;
 restore=()=>{if(search)search.value=value;render();for(const detail of list.querySelectorAll('details'))detail.open=opened.includes(detail.dataset.helpTopic);};
 window.print();
});
window.addEventListener('afterprint',()=>{restore?.();restore=null;});
render();
syncHelpView();
