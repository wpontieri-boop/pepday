import {config} from '/config.js';
import {isPartnerEnvironment} from '/src/partner-environment.mjs';
const $=id=>document.getElementById(id), hide=(id,yes=true)=>$(id).classList.toggle('hidden',yes);
const allowed=config.environment==='test'&&isPartnerEnvironment(config,location);
const client=allowed?globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:`pepday-${config.environment}-${config.projectRef}-admin-auth`}}):null;
const TYPES={contract:'Contrato',fiscal:'Documento fiscal',receipt:'Recibo',payout_proof:'Comprovante de repasse'};
const ST={pending:'Pendente',divergent:'Divergente',approved:'Aprovado'};
let context=null,finance=null,details=null,pending=null,reauth=null,factor='',busy=false;
const status=(message,target='status')=>$(target).textContent=message;
const message=e=>({PARTNER_FISCAL_PENDING:'Configuração fiscal não validada pela contabilidade.',PARTNER_DOCUMENT_PENDING:'Documento ou retenção ainda pendente.',PARTNER_STEPUP_INVALID:'A confirmação expirou ou já foi utilizada.',PARTNER_INVALID_DOCUMENT_SCOPE:'Tipo de documento incompatível com o lote.',PARTNER_INVALID_WITHHOLDING:'Confira as retenções e a base documentada.',PARTNER_RECENT_PASSWORD_TOTP_REQUIRED:'Faça novo login com senha e TOTP para continuar.'})[e?.message]||'Operação não concluída. Nenhuma transferência foi realizada.';
const money=value=>value===null||value===undefined?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)/100);
const rpc=async(name,args={})=>{const res=await client.rpc(name,args);if(res.error)throw res.error;return res.data};
function row(container,title,info){const a=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');h.textContent=title;p.textContent=info;a.append(h,p);$(container).append(a);return a}
function btn(text,handler){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',handler);return b}
async function task(fn,target='status'){if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;try{await fn()}catch(e){status(message(e),target);if(target!=='status')status(message(e),'status')}finally{busy=false;for(const b of document.querySelectorAll('button'))b.disabled=false;syncDocSelection()}}
function clearAttempt(){pending=null;factor='';$('password').value='';$('totp').value='';if(reauth){const temp=reauth;reauth=null;temp.auth.signOut({scope:'local'}).catch(()=>{})}hide('totpForm');hide('passwordForm',false);status('','stepupStatus')}
function reset(){clearAttempt();details=null;context=null;finance=null;hide('module');hide('access',false);if($('stepup').open)$('stepup').close();if($('batchDialog').open)$('batchDialog').close()}
function retentionInputs(){
 for(const [type,label] of Object.entries(TYPES)){
  const section=document.createElement('section');section.className='retention';
  const heading=document.createElement('strong');heading.textContent=label;section.append(heading);
  const checkbox=document.createElement('label'),checked=document.createElement('input');checked.type='checkbox';checked.id='r_'+type+'_validated';checkbox.append(checked,document.createTextNode(' Parecer jurídico/contábil validado'));section.append(checkbox);
  for(const [field,title] of [['legal_basis','Fundamento legal documentado'],['start_event','Marco inicial da contagem'],['months','Prazo em meses (somente se validado)']]){
   const lab=document.createElement('label'),input=document.createElement('input');input.id='r_'+type+'_'+field;input.maxLength=field==='months'?4:160;input.autocomplete='off';input.placeholder=title;lab.append(document.createTextNode(title),input);section.append(lab)}
  $('retentionFields').append(section)
 }
}
function getRetention(){const result={};for(const type of Object.keys(TYPES)){const validated=$('r_'+type+'_validated').checked,legal_basis=$('r_'+type+'_legal_basis').value.trim(),start_event=$('r_'+type+'_start_event').value.trim(),months=$('r_'+type+'_months').value.trim();result[type]={validated,legal_basis,start_event};if(months)result[type].months=months}return result}
function setRetention(data){for(const type of Object.keys(TYPES)){const v=data?.[type]||{};$('r_'+type+'_validated').checked=v.validated===true;$('r_'+type+'_legal_basis').value=v.legal_basis||'';$('r_'+type+'_start_event').value=v.start_event||'';$('r_'+type+'_months').value=v.months??''}}
function ensureProfile(){const retention=getRetention();if($('profileState').value==='approved'){if(!$('accountingReference').value.trim()||!$('legalReference').value.trim()||Object.values(retention).some(r=>!r.validated||r.legal_basis.length<3||r.start_event.length<3))throw Error('PARTNER_FISCAL_PENDING')}return retention}
function syncDocSelection(){const type=$('documentType').value;hide('documentPayoutLabel',!type||type==='contract');$('documentPayout').required=Boolean(type&&type!=='contract');$('documentSubmit').disabled=busy||!details?.can_manage||!type||(type!=='contract'&&!$('documentPayout').value);}
function resetDocType(){// Explicit empty selection: never silently default to contract or fiscal.
 $('documentForm').reset();$('documentType').value='';$('documentPayout').value='';syncDocSelection()
}
const validMime=async(file)=>{const mime=file.type;const head=new Uint8Array(await file.slice(0,8).arrayBuffer());if(mime==='application/pdf')return String.fromCharCode(...head.slice(0,5))==='%PDF-';if(mime==='image/png')return [137,80,78,71,13,10,26,10].every((n,i)=>head[i]===n);if(mime==='image/jpeg')return head[0]===255&&head[1]===216&&head[2]===255;return false};
const fingerprint=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
const selected=()=>$('partner').value;
async function load(){
 if(!finance){const old=$('partner').value;finance=await rpc('admin_partner_finance',{p_partner:null});$('partner').replaceChildren(new Option('Escolha um parceiro',''));for(const p of finance.partners)$('partner').add(new Option(p.public_name,p.id));const url=new URL(location.href),id=old||url.searchParams.get('partner');if(id&&finance.partners.some(p=>p.id===id))$('partner').value=id}
 const partner=selected();if(!partner){details=null;for(const id of ['profileSection','documentSection','batchSection'])hide(id);$('kind').textContent='Selecione um parceiro para consultar dados fiscais.';return}
 details=await rpc('admin_partner_fiscal',{p_partner:partner});$('kind').textContent='Tipo cadastrado: '+(details.kind||'Aguardando cadastro CPF/CNPJ');
 $('state').textContent='Situação: '+(ST[details.state]||'Pendente');$('ready').textContent=details.ready?'Conferência do parceiro: pronta.':'Conferência do parceiro: BLOQUEADA.';
 for(const id of ['profileSection','documentSection','batchSection'])hide(id,!details.can_manage);
 $('readonly').replaceChildren();row('readonly','Situação fiscal',details.ready?'Pronto conforme regras do servidor.':'Pendências bloqueiam liberação e repasse.');
 if(details.can_manage){
  const cfg=details.configuration||{};$('profileState').value=details.state||'pending';$('fiscalRequired').checked=cfg.fiscal_document_required===true;
  $('accountingReference').value=cfg.accounting_reference||'';$('legalReference').value=cfg.legal_reference||'';setRetention(cfg.retention);
  $('documents').replaceChildren();
  for(const doc of details.documents||[]){
   const article=row('documents',(TYPES[doc.document_type]||doc.document_type)+' · '+(ST[doc.state]||doc.state),doc.stored?'Arquivo guardado em armazenamento privado':'Arquivo ainda não armazenado');
   if(doc.stored)article.append(btn('Baixar (OWNER)',()=>start({action:'document_access',document_id:doc.id,operation:'download',reason:'Consulta operacional documentada'},null)));
   else {const retry=document.createElement('input');retry.type='file';retry.accept='.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';retry.setAttribute('aria-label','Reenviar o arquivo original deste documento');retry.addEventListener('change',()=>task(async()=>{const file=retry.files[0];if(!file||file.size===0||file.size>5242880||!(await validMime(file))||(await fingerprint(file))!==doc.sha256)throw Error('DOCUMENT_INTEGRITY_FAILED');start({action:'document_access',document_id:doc.id,operation:'upload',reason:'Retentativa segura de arquivo pendente'},file)}));article.append(retry)}
   for(const state of ['approved','divergent'])if(doc.state!==state&&doc.stored)article.append(btn(state==='approved'?'Aprovar documento':'Marcar divergência',()=>{const why=prompt('Motivo operacional, sem dados pessoais:');if(why?.trim()?.length>=3)start({action:'document_review',document_id:doc.id,state,reason:why.trim()},null)}));
  }
  $('documentPayout').replaceChildren(new Option('Escolha o lote',''));
  for(const b of details.payouts||[])if(b.payout_state==='reserved')$('documentPayout').add(new Option(money(b.gross_cents)+' · '+b.id.slice(0,8),b.id));
  resetDocType();$('batches').replaceChildren();
  for(const b of details.payouts||[]){
   const a=row('batches',money(b.gross_cents)+' · '+(ST[b.state]||'Pendente'),(b.ready?'Documentação liberada':'Repasse bloqueado')+' · Retido '+money(b.withheld_cents)+' · Líquido '+money(b.net_cents));
   if(b.payout_state==='reserved')a.append(btn('Conferir retenções',()=>openBatch(b)))
  }
 }
}
function start(payload,file=null){if(!details?.can_manage||!selected())return;clearAttempt();pending={partner:selected(),payload,file};$('stepupAction').textContent='Ação: '+payload.action;hide('passwordForm',false);hide('totpForm');$('stepup').showModal()}
async function uploadOrDownload(docId,op,file){
 const session=await client.auth.getSession();if(session.error||!session.data.session?.access_token)throw Error('AUTH_REQUIRED');
 const headers={Authorization:'Bearer '+session.data.session.access_token,apikey:config.supabasePublishableKey,'x-document-id':docId,'x-document-operation':op};
 if(op==='upload')headers['Content-Type']=file.type;
 const res=await fetch(config.supabaseUrl+'/functions/v1/partner-documents',{method:'POST',headers,body:op==='upload'?file:undefined,cache:'no-store'});
 if(!res.ok)throw Error('DOCUMENT_ACCESS_DENIED');
 if(op==='download'){const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='documento-privado';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
async function executePending(){
 const p=pending;if(!p)throw Error('PARTNER_STEPUP_INVALID');
 const ticket=await rpc('admin_prepare_partner_finance',{p_partner:p.partner,p_payload:p.payload});
 const result=await rpc('admin_partner_fiscal_action',{p_partner:p.partner,p_payload:p.payload,p_ticket:ticket});
 if(p.payload.action==='document_create'){await uploadOrDownload(result.id,'upload',p.file)}
 if(p.payload.action==='document_access'){await uploadOrDownload(p.payload.document_id,p.payload.operation,p.file)}
 status('Operação concluída em TEST; nenhum pagamento ou transferência foi realizado.');
 clearAttempt();finance=null;await load()
}
function openBatch(b){$('batchForm').reset();$('batchTitle').textContent='Lote reservado: '+money(b.gross_cents);$('batchDialog').dataset.id=b.id;$('batchDialog').showModal()}
function centsFromInput(s){const m=/^([0-9]{1,10})(?:,([0-9]{1,2}))?$/.exec(s.trim());if(!m)throw Error('PARTNER_INVALID_WITHHOLDING');return String(BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0')))}
$('profileForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>start({action:'fiscal_profile',state:$('profileState').value,fiscal_document_required:$('fiscalRequired').checked,accounting_reference:$('accountingReference').value.trim(),legal_reference:$('legalReference').value.trim(),retention:ensureProfile(),reason:$('profileReason').value.trim()}))});
$('documentForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 const type=$('documentType').value,lot=$('documentPayout').value,file=$('documentFile').files[0];
 if(!type||!TYPES[type]||(type!=='contract'&&!lot)||!file||file.size===0||file.size>5242880||!(await validMime(file)))throw Error('PARTNER_INVALID_DOCUMENT_SCOPE');
 const payload={action:'document_create',document_type:type,sha256:await fingerprint(file),mime_type:file.type,size_bytes:file.size,reason:$('documentReason').value.trim()};if(type!=='contract')payload.payout_id=lot;start(payload,file)
 })});
$('batchForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{const tax=$('taxName').value.trim(),basis=$('taxBasis').value.trim(),val=$('taxValue').value.trim(),none=$('noWithholding').checked;
 if(none&&(tax||basis||val))throw Error('PARTNER_INVALID_WITHHOLDING');
 const list=none?[]:[{tax,basis,amount_cents:centsFromInput(val)}];
 $('batchDialog').close();start({action:'fiscal_batch',payout_id:$('batchDialog').dataset.id,state:$('batchState').value,withholdings:list,no_withholding_confirmed:none,accounting_reference:$('batchAccounting').value.trim(),reason:$('batchReason').value.trim()})})});
$('passwordForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 if(!context||!pending)throw Error('PARTNER_STEPUP_INVALID');
 if(reauth)await reauth.auth.signOut({scope:'local'});reauth=globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'pepday-fiscal-stepup-memory'}});
 try{const result=await reauth.auth.signInWithPassword({email:context.email,password:$('password').value});if(result.error||result.data.user?.email?.toLowerCase()!==context.email.toLowerCase())throw Error('REAUTH_FAILED');const list=await reauth.auth.mfa.listFactors();if(list.error)throw list.error;factor=list.data.totp.find(t=>t.status==='verified')?.id||'';if(!factor)throw Error('MFA_REQUIRED');hide('passwordForm');hide('totpForm',false);status('Informe um novo TOTP.','stepupStatus')}finally{$('password').value=''}
 },'stepupStatus')});
$('totpForm').addEventListener('submit',e=>{e.preventDefault();task(async()=>{
 try{if(!pending||!reauth||!factor)throw Error('PARTNER_STEPUP_INVALID');const v=await reauth.auth.mfa.challengeAndVerify({factorId:factor,code:$('totp').value});if(v.error)throw v.error;const session=await client.auth.setSession({access_token:v.data.access_token,refresh_token:v.data.refresh_token});if(session.error)throw session.error;reauth=null;$('stepup').close();await executePending()}finally{$('totp').value=''}
 },'stepupStatus')});
$('cancelBatch').addEventListener('click',()=>$('batchDialog').close());$('cancelStepup').addEventListener('click',()=>{$('stepup').close();clearAttempt()});$('stepup').addEventListener('cancel',clearAttempt);
$('documentType').addEventListener('change',syncDocSelection);$('documentPayout').addEventListener('change',syncDocSelection);
$('partner').addEventListener('change',()=>task(async()=>{finance=null;await load()}));$('refresh').addEventListener('click',()=>task(async()=>{finance=null;await load()}));
$('exit').addEventListener('click',()=>task(async()=>{const r=await client.auth.signOut({scope:'local'});if(r.error)throw r.error;reset();status('Sessão local encerrada.','accessStatus')}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){$('password').value='';$('totp').value='';$('documentFile').value=''}});
retentionInputs();resetDocType();
async function init(){if(!allowed){status('Disponível somente em homologação TEST.','accessStatus');return}
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')reset()});
 await task(async()=>{const u=await client.auth.getUser();if(u.error||!u.data.user)throw Error('AUTH_REQUIRED');context=await rpc('get_admin_context');if(context.aal!=='aal2')throw Error('MFA_REQUIRED');await load();hide('access');hide('module',false)},'accessStatus')}
init();
