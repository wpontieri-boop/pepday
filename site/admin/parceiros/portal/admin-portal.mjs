import {config} from '/config.js';
import {installWhatsAppMonitor} from './whatsapp-monitor.mjs';
import {makeManualInviteDraft,eligibleReminder} from '/src/partner-onboarding-policy.mjs';
const $=id=>document.getElementById(id),hide=(id,on=true)=>$(id).classList.toggle('hidden',on);
const allowed=config.environment==='test'&&config.projectRef==='fsbqpyyprtymwrmzsacp'&&location.origin==='https://homologacao.pepday.com.br';
const client=allowed?globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'pepday-test-fsbqpyyprtymwrmzsacp-admin-auth'}}):null;
let busy=false,invites=[],issued=null,messageInvite=null,epoch=0;
async function rpc(name,args){const attempt=epoch;const {data,error}=await client.rpc(name,args);if(error||attempt!==epoch)throw error||Error('STALE');return data}
const action=(action,args={})=>rpc('admin_partner_portal',{p_request:{action,...args}});
function clearLink(){issued=null;$('link').value='';$('message').value='';hide('issued');$('humanConfirm').checked=false;$('confirmSimulation').disabled=true;messageInvite=null;if($('messageDialog').open)$('messageDialog').close()}
async function task(fn){if(busy||!allowed)return;busy=true;try{await fn()}catch{$('status').textContent='Operação não concluída. Confira OWNER, sessão válida, dados sintéticos, validade e consentimento.'}finally{busy=false}}
function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>task(fn));return b}
async function load(){
 const data=await action('list');invites=data.invites;
 const partners=await rpc('admin_list_partners',{p_query:'QA ',p_include_archived:false}),selected=$('partner').value;
 $('partner').replaceChildren(new Option('Escolha um rascunho sintético',''));
 for(const p of partners.filter(p=>p.status==='draft'&&p.public_name.startsWith('QA ')))$('partner').append(new Option(p.public_name,p.id));$('partner').value=selected;
 $('invites').replaceChildren();for(const i of invites){
 const article=document.createElement('article'),title=document.createElement('h3'),p=document.createElement('p'),audit=document.createElement('details'),summary=document.createElement('summary'),events=document.createElement('ul');
 title.textContent=i.public_name;const state=i.revoked_at?'Revogado':Date.parse(i.expires_at)<=Date.now()?'Expirado':i.completed_at?'Concluído tecnicamente':i.sent_at?'Enviado · simulação':'Pendente';
 p.textContent=state+' · cadastro '+i.submission.state+' · expira '+new Date(i.expires_at).toLocaleString('pt-BR')+' · '+(i.opted_out?'contatos cancelados':'opt-in '+(i.opt_in?'sim':'não'));
 summary.textContent='Auditoria ('+i.events.length+')';for(const e of i.events){const li=document.createElement('li');li.textContent=e.created_at+' · '+e.kind;events.append(li)}audit.append(summary,events);article.append(title,p,audit);
 if(!i.revoked_at&&!i.completed_at&&Date.parse(i.expires_at)>Date.now()){
 article.append(button('Revogar convite',async()=>{await action('revoke',{id:i.id});clearLink();await load()}));
 article.append(button('Cancelar mensagens',async()=>{await action('cancel_messages',{id:i.id});await load()}));
 const prepare=button('Enviar convite pelo WhatsApp',async()=>{
 if(issued?.id!==i.id)throw Error('REISSUE_REQUIRED');
 const draft=makeManualInviteDraft({role:'owner',partnerStatus:'draft',whatsappOptIn:i.opt_in,contactConfirmed:i.contact_confirmed,optedOut:i.opted_out,phoneE164:'+5500000000000',privateInviteLink:issued.link,publicName:i.public_name,explicitOperatorClick:true});
 await action('prepare_message',{id:i.id});messageInvite=i.id;$('message').value=draft.message;$('humanConfirm').checked=false;$('confirmSimulation').disabled=true;$('messageDialog').showModal();
 });prepare.disabled=issued?.id!==i.id||!i.opt_in||!i.contact_confirmed||i.opted_out;article.append(prepare);
 const reminder=eligibleReminder({status:'pending',whatsappOptIn:i.opt_in,contactConfirmed:i.contact_confirmed,optedOut:i.opted_out,sentAt:i.sent_at,expiresAt:i.expires_at,events:i.messages.filter(m=>m.state==='simulated').map(m=>m.kind)});
 if(reminder)article.append(button('Preparar lembrete '+reminder.toUpperCase()+' · sem envio',async()=>{await action('queue_reminders',{id:i.id});await load()}));
 const challengeEvent=[...i.events].reverse().find(e=>e.kind==='challenge_created');
 if(challengeEvent)article.append(button('Obter código QA para verificação',async()=>{const r=await action('qa_code',{id:i.id,challenge:challengeEvent.metadata.challenge});$('status').textContent='Código QA: '+r.code+' · temporário, sem entrega externa.'}));
 if(i.submission.state==='submitted'){
 for(const decision of ['corrections','approved_test'])article.append(button(decision==='corrections'?'Solicitar correção QA':'Concluir revisão técnica QA',async()=>{await action('review',{id:i.id,decision,version:i.submission.version,reason:decision==='corrections'?'QA corrigir cadastro':'QA revisao tecnica'});await load();$('status').textContent='Revisão registrada. Não ativa parceiro, não altera comissão nem libera pagamento.'}));
 }
 for(const d of i.documents){const dp=document.createElement('p');dp.textContent='Amostra '+d.id+' · '+d.state;article.append(dp);if(d.state==='stored')for(const decision of ['corrections','approved_test'])article.append(button(decision==='corrections'?'Pedir correção da amostra':'Aprovar amostra QA',async()=>{await action('review_document',{id:i.id,document:d.id,decision,reason:'QA revisao da amostra'});await load()}))}
 }
 const ms=document.createElement('p');ms.textContent='Fila simulada: '+(i.messages.map(m=>m.kind+' '+m.state).join(', ')||'vazia');article.append(ms);$('invites').append(article);
 }if(!invites.length)$('invites').textContent='Nenhum convite. Use somente rascunhos sintéticos autorizados.';
}
$('issueForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{clearLink();issued=await action('issue',{partner_id:$('partner').value,email:$('email').value,opt_in:$('optIn').checked,contact_confirmed:$('confirmed').checked});$('link').value=issued.link;hide('issued',false);await load();$('status').textContent='Convite individual emitido; nenhum envio automático.'})});
$('copyLink').addEventListener('click',()=>task(async()=>{if(!issued)throw Error('REISSUE_REQUIRED');await navigator.clipboard.writeText(issued.link);$('status').textContent='Convite copiado para uso QA autorizado.'}));
$('humanConfirm').addEventListener('change',()=>{$('confirmSimulation').disabled=!$('humanConfirm').checked});
$('confirmSimulation').addEventListener('click',()=>task(async()=>{if(!$('humanConfirm').checked||!messageInvite)throw Error('CONFIRM_REQUIRED');await action('confirm_simulation',{id:messageInvite,confirmed:true});$('messageDialog').close();$('message').value='';messageInvite=null;await load();$('status').textContent='Simulação registrada. Nenhuma mensagem foi enviada.'}));
$('cancelMessage').addEventListener('click',()=>{clearLink()});
$('refresh').addEventListener('click',()=>task(load));
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearLink();$('status').textContent='Dados temporários limpos. Reemita convite se precisar de um novo link.'}});
addEventListener('pagehide',()=>{clearLink();$('status').textContent=''});
async function init(){if(allowed)client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){epoch++;clearLink();clearMonitor();invites=[];$('invites').replaceChildren();hide('module');hide('access',false);$('accessStatus').textContent='Sessão encerrada.'}});if(!allowed){$('accessStatus').textContent='Disponível exclusivamente em TEST.';return}await task(async()=>{const u=await client.auth.getUser();if(u.error||!u.data.user)throw Error('AUTH');const c=await rpc('get_admin_context');if(c.access_level!=='owner'||c.aal!=='aal2')throw Error('OWNER');await load();hide('access');hide('module',false)});if(!$('access').classList.contains('hidden'))$('accessStatus').textContent='Sessão OWNER TEST válida com senha e 2FA necessária.'}
const clearMonitor=installWhatsAppMonitor({rpc,run:task,canRead:()=>allowed&&!$('module').classList.contains('hidden')});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearMonitor()});
addEventListener('pagehide',clearMonitor);
init();
