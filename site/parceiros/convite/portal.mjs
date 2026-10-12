import {config} from '/config.js';
const $=id=>document.getElementById(id),hide=(id,on=true)=>$(id).classList.toggle('hidden',on);
const allowed=config.environment==='test'&&config.projectRef==='fsbqpyyprtymwrmzsacp'&&location.origin==='https://homologacao.pepday.com.br';
const SAMPLE='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4XcAAAAASUVORK5CYII=';
let invite='',challenge='',session='',view=null,busy=false,epoch=0;
// Remove capability from address/history immediately; never localStorage, Admin or client Auth.
if(allowed&&/^#invite=[A-Za-z0-9_-]{43}$/.test(location.hash))invite=location.hash.slice(8);
history.replaceState(null,'',location.pathname);
async function api(action,args={}){const attempt=epoch;
 const r=await fetch(config.supabaseUrl+'/functions/v1/partner-portal',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey},referrerPolicy:'no-referrer',cache:'no-store',body:JSON.stringify({action,...(session?{session}:{}),...args})});
 if(!r.ok)throw Error('DENIED');const result=await r.json();if(!result.ok||attempt!==epoch)throw Error('DENIED');return result;
}
function reset(){epoch++;invite='';challenge='';session='';view=null;$('otp').value='';$('draftForm').reset();$('documents').replaceChildren();hide('workspace');hide('access',false);hide('otpForm');$('challenge').disabled=true}
async function task(fn){if(busy||!allowed)return;busy=true;document.querySelectorAll('button:not([disabled])').forEach(b=>{b.dataset.busy='1';b.disabled=true});try{await fn()}catch{$('status').textContent='Operação não concluída. Confira validade, código e limite de tentativas. Nenhum dado real ou pagamento foi processado.'}finally{busy=false;document.querySelectorAll('button[data-busy]').forEach(b=>{delete b.dataset.busy;b.disabled=false});if(view)render(view);if(!invite)$('challenge').disabled=true}}
function render(data){view=data;hide('access');hide('workspace',false);$('publicName').textContent=data.public_name;const s=data.submission;
 $('state').textContent='Situação: '+({draft:'Rascunho',submitted:'Em revisão',corrections:'Correção solicitada',approved_test:'Revisão técnica concluída · parceria permanece inativa'}[s.state]||'Pendente');
 for(const [field,id] of [['kind','kind'],['legal_name','legalName'],['document','document'],['email','email'],['pix_key','pixKey']])if(s.data[field])$(id).value=s.data[field];
 $('correction').textContent=s.correction||'';const locked=!['draft','corrections'].includes(s.state);
 $('save').disabled=locked;$('submit').disabled=locked;$('upload').disabled=s.state==='approved_test';$('contractSeen').disabled=s.state==='approved_test';for(const el of $('draftForm').elements)if(el.tagName!=='BUTTON')el.disabled=locked;
 $('contractVersion').textContent='Versão: '+data.contract.version+' · hash '+data.contract.sha256;$('contractBody').textContent=data.contract.body;
 $('documents').replaceChildren();for(const d of data.documents){const p=document.createElement('article'),text=document.createElement('p');text.textContent='Amostra '+d.id+' · '+d.state+(d.reason?' · '+d.reason:'');p.append(text);
 if(d.state!=='pending'){const b=document.createElement('button');b.textContent='Baixar amostra privada';b.addEventListener('click',()=>task(async()=>{const r=await fetch(config.supabaseUrl+'/functions/v1/partner-portal',{method:'POST',headers:{'Content-Type':'application/json',apikey:config.supabasePublishableKey},cache:'no-store',referrerPolicy:'no-referrer',body:JSON.stringify({action:'download_sample',session,id:d.id})});if(!r.ok)throw Error('DENIED');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='amostra-QA.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}));p.append(b)}$('documents').append(p)}
}
const draft=()=>({kind:$('kind').value,legal_name:$('legalName').value.trim(),document:$('document').value,email:$('email').value.trim(),pix_key:'QA-ONLY-NOT-A-PIX'});
$('challenge').addEventListener('click',()=>task(async()=>{const r=await api('challenge',{invite});challenge=r.challenge;$('challengeRef').textContent='Referência do código QA: '+challenge;hide('otpForm',false);$('status').textContent='Solicitação registrada. O OWNER fornece o código sintético; nenhum envio real.'}));
$('otpForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{try{const r=await api('verify',{invite,challenge,code:$('otp').value});session=r.session;render(r.view);$('status').textContent='Sessão privada sintética verificada.'}finally{$('otp').value=''}})});
$('kind').addEventListener('change',()=>{$('document').value=$('kind').value==='CPF'?'00000000000':'00000000000000'});
$('draftForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{const r=await api('save',{data:draft(),version:view.submission.version});render(r.view);$('status').textContent='Rascunho salvo; P1/P2 e pagamentos preservados.'})});
$('submit').addEventListener('click',()=>{if(!$('draftForm').reportValidity())return;task(async()=>{const r=await api('submit',{data:draft(),version:view.submission.version});render(r.view);$('status').textContent='Enviado para revisão manual do OWNER. Parceria não ativada.'})});
$('refresh').addEventListener('click',()=>task(async()=>render((await api('view')).view)));
$('contractSeen').addEventListener('click',()=>task(async()=>{await api('contract_seen',{version:view.contract.version,hash:view.contract.sha256});$('status').textContent='Leitura da minuta técnica registrada. Não é aceite contratual.'}));
$('upload').addEventListener('click',()=>task(async()=>{await api('upload_sample',{sample:SAMPLE});render((await api('view')).view);$('status').textContent='Amostra sintética armazenada em área privada.'}));
$('logout').addEventListener('click',()=>task(async()=>{try{await api('logout')}finally{reset();$('status').textContent='Sessão local encerrada; reabra o convite para nova verificação.'}}));
$('optOut').addEventListener('click',()=>task(async()=>{await api('opt_out');reset();$('status').textContent='Contatos cancelados e sessão revogada.'}));
addEventListener('pagehide',reset);
if(!allowed||!invite){$('challenge').disabled=true;$('status').textContent='Abra um convite privado válido de homologação. Nenhum acesso ao Admin ou cadastro público é concedido.'}
