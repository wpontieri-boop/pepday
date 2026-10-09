import {financialErrors,normalizeDocument,normalizePix} from './validation.mjs?v=3';
import {config} from '/config.js';
import {isPartnerEnvironment} from '/src/partner-environment.mjs';
const $=id=>document.getElementById(id),hide=(id,value=true)=>$(id).classList.toggle('hidden',value);
const client=globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:`pepday-${config.environment}-${config.projectRef}-admin-auth`}});
let context=null,selected=null,pending=null,factor='',busy=false,reauthClient=null,includeArchived=false;
const messages={PARTNER_NO_CHANGES:'Altere o percentual ou escolha um dado financeiro para editar.',PARTNER_LOGIN_EXPIRED:'Sua sessão administrativa expirou. Entre no painel novamente com senha e TOTP.',PARTNER_STEPUP_REQUIRED:'Este parceiro já foi ativado. Confirme a alteração com senha e TOTP.',PARTNERS_DISABLED:'Módulo aguardando ativação neste ambiente.',PARTNER_FINANCIAL_CONFIGURATION_REQUIRED:'Complete a configuração financeira, e-mail e telefone antes de ativar.',PARTNER_INVALID_FINANCIAL_DATA:'Confira CPF/CNPJ, percentual e os dados financeiros.',PARTNER_INVALID_PIX:'Confira o tipo e o formato da chave PIX.',PARTNER_STEPUP_INVALID:'A autorização expirou ou não corresponde à alteração. Reautentique.',PARTNER_RECENT_PASSWORD_TOTP_REQUIRED:'Confirme novamente senha e código do autenticador.',PARTNER_SESSION_REVOKED:'Sessão encerrada. Entre novamente no painel.',PARTNER_NOT_EDITABLE:'Parceiro arquivado ou indisponível.'};
function errorText(e){return messages[e?.message]||'Não foi possível concluir. Confira os dados e seu acesso.'}
async function rpc(name,args={}){const {data,error}=await client.rpc(name,args);if(error)throw error;return data}
function text(id,value){$(id).textContent=value}
function clearFinance(){clearErrors($('financialForm'));$('financialForm').reset();$('stepupPassword').value='';$('stepupCode').value='';pending=null;factor='';if(reauthClient){const temp=reauthClient;reauthClient=null;temp.auth.signOut({scope:'local'}).catch(()=>{})}}
function reset(){context=null;selected=null;clearFinance();$('partnerForm').reset();$('list').replaceChildren();hide('module');hide('access',false);if($('stepup').open)$('stepup').close()}
async function run(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn()}catch(e){if(['PARTNER_LOGIN_EXPIRED','PARTNER_SESSION_REVOKED'].includes(e.message)){reset();text('accessStatus',errorText(e))}else text('status',errorText(e))}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
function action(label,fn){const b=document.createElement('button');b.type='button';b.className='ghost';b.textContent=label;b.addEventListener('click',()=>run(fn));return b}
const protectedFields=['legalName','document','payeeName','pixType','pixKey'];
function financeState(){
  const configured=!!selected?.financial_ready;
  const f=selected?.financial||{};
  const values={legalName:f.legal_name||'',document:f.document_masked||'',payeeName:f.payee_name_masked||'',pixType:f.pix_type||'',pixKey:f.pix_key_masked||''};
  for(const id of protectedFields){$(id).value=configured?values[id]:'';$(id).disabled=configured;}
  document.querySelectorAll('[data-financial-edit]').forEach(b=>{b.classList.toggle('hidden',!configured);b.textContent=b.getAttribute('aria-label');});
  $('commissionPercent').value=selected?.commission_percent??'';
  hide('saveAndActivate',selected?.status==='active');
  text('saveFinance',configured?'Salvar alteração financeira':'Salvar configuração financeira');
  text('financeHelp',configured?'Altere somente o que precisa. CPF/CNPJ, titular e PIX ficam protegidos; use Alterar para informar novos dados. Após a primeira ativação, salvar exige confirmação extra.':'Complete os campos obrigatórios (*). O cadastro inicial usa sua sessão administrativa válida. Após a primeira ativação, alterações financeiras exigem confirmação extra.');
}
function edit(p){selected=p;$('partnerId').value=p.id;$('publicName').value=p.public_name;$('partnerType').value=p.partner_type;$('city').value=p.city;$('description').value=p.description;$('contactName').value=p.contact?.name||'';$('contactEmail').value=p.contact?.email||'';$('contactPhone').value=p.contact?.phone||'';clearErrors($('partnerForm'));text('editTitle',`Editar: ${p.public_name}`);clearFinance();financeState();hide('financialSection',context.access_level!=='owner'||p.status==='archived');if(p.status!=='archived')$('editSection').scrollIntoView({behavior:'smooth',block:'start'})}
document.querySelectorAll('[data-financial-edit]').forEach(button=>button.addEventListener('click',()=>{
  const id=button.dataset.financialEdit,ids=id==='pixKey'?['pixType','pixKey']:[id];
  const enable=$(id).disabled;
  for(const field of ids){$(field).disabled=!enable;$(field).value='';}
  if(!enable){
    const f=selected.financial||{};const values={legalName:f.legal_name,document:f.document_masked,payeeName:f.payee_name_masked,pixType:f.pix_type,pixKey:f.pix_key_masked};
    for(const field of ids)$(field).value=values[field]||'';
  }else if(id==='legalName')$(id).value=selected.financial?.legal_name||'';
  clearErrors($('financialForm'));button.textContent=enable?'Cancelar alteração':button.getAttribute('aria-label');if(enable)$(ids[0]).focus();
}));
async function load(){
  try{
    const m=await rpc('admin_partner_referral_metrics');
    text('referralMetrics',m.enabled?`${m.clicks} cliques dirigidos · ${m.intents_created} intenções criadas · ${m.intents_replaced} substituídas · ${m.intents_expired} expiradas · ${m.intents_consumed} consumidas · ${m.benefits_with_partner} benefícios com parceiro · ${m.benefits_without_partner} sem parceiro`:'Atribuição aguardando ativação neste ambiente.');
    $('referralPartnerMetrics').replaceChildren();for(const p of m.partners||[]){const li=document.createElement('li');li.textContent=`${p.public_name} · ${p.clicks} cliques · ${p.activations} ativações`;$('referralPartnerMetrics').append(li)}
  }catch{text('referralMetrics','Indicadores temporariamente indisponíveis.')}
  const rows=await rpc('admin_list_partners',{p_query:$('filter').value.trim(),p_include_archived:includeArchived});
  if(selected){const current=rows.find(p=>p.id===selected.id);if(current)selected=current}
  const list=$('list');list.replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.textContent='Nenhum parceiro encontrado.';list.append(p)}
  for(const p of rows){
    const card=document.createElement('article');card.className='partner-row';
    const h=document.createElement('h3');h.textContent=p.public_name;
    const meta=document.createElement('small');meta.textContent=[p.city,p.partner_type,p.commission_percent==null?'Percentual não configurado':`${p.commission_percent}% · primeiro pagamento`].filter(Boolean).join(' · ');
    const link=new URL('/cartao/',config.runtimeUrl);link.searchParams.set('ref',p.slug);
    const badge=document.createElement('span');badge.className=`status-badge status-${p.status}`;badge.textContent=({draft:'Rascunho',active:'Ativo',suspended:'Suspenso',archived:'Arquivado'})[p.status]||p.status;
    const code=document.createElement('code');code.textContent=`${p.public_code} · ${link.href}`;
    const hint=document.createElement('p');hint.className='muted';hint.textContent=p.status==='active'?'Parceiro disponível na busca pública.':'Link reservado; indisponível para indicação enquanto não estiver ativo.';
    const summary=document.createElement('p');summary.className='financial-summary';summary.textContent=p.financial_ready?'Configuração financeira aprovada pelo OWNER.':'Aguardando aprovação do OWNER';
    const help=document.createElement('details');help.className='activation-help';const helpTitle=document.createElement('summary');helpTitle.textContent=p.status==='active'?'ⓘ Parceiro ativo':p.status==='archived'?'ⓘ Histórico preservado':'ⓘ Ativar parceiro';const helpBody=document.createElement('p');helpBody.textContent=p.status==='archived'?'Cadastro arquivado e preservado para histórico e auditoria. Não recebe novas indicações.':p.status==='active'?'Link e código disponíveis na busca pública. A indicação é fechada na liberação dos 30 dias PRO.':'A ativação torna o link e o código válidos para indicação. Exige financeiro aprovado pelo OWNER, e-mail e telefone.';help.append(helpTitle,helpBody);
    const actions=document.createElement('div');actions.className='partner-actions';
    if(context.can_write&&p.status!=='archived'){
      actions.append(action('Editar cadastro',async()=>edit(p)));
      if(p.status==='active'||p.financial_ready)actions.append(action(p.status==='active'?'Suspender':'Ativar',async()=>{await rpc('admin_set_partner_status',{p_id:p.id,p_status:p.status==='active'?'suspended':'active',p_reason:p.status==='active'?'pausa_comercial':'cadastro_concluido'});await load()}));
      actions.append(action('Arquivar',async()=>{if(confirm(`Arquivar ${p.public_name}? O histórico será preservado.`)){await rpc('admin_set_partner_status',{p_id:p.id,p_status:'archived',p_reason:'encerramento'});selected=null;clearFinance();hide('financialSection');await load()}}));
    }
    if(p.status==='active'){
      actions.append(action('Copiar link',async()=>{await navigator.clipboard.writeText(link.href);text('status','Link copiado.')}));
      actions.append(action('Compartilhar',async()=>{if(navigator.share)await navigator.share({title:'PepDay',url:link.href});else {await navigator.clipboard.writeText(link.href);text('status','Link copiado para compartilhar.')}}));
    }
    card.append(h,badge,meta,summary,code,hint,help,actions);list.append(card);
  }
}
async function init(){
  if(!isPartnerEnvironment(config,location)){text('accessStatus','Módulo indisponível neste endereço.');return}
  text('partnerEnvironment',config.environment==='production'?'PRODUÇÃO':'HOMOLOGAÇÃO');
  hide('financeLink',config.environment!=='test');
  try{
    const {data,error}=await client.auth.getUser();if(error||!data?.user)throw new Error('AUTH_REQUIRED');
    context=await rpc('get_admin_context');if(context.aal!=='aal2')throw new Error('MFA_REQUIRED');
    await load();hide('access');hide('module',false);hide('editSection',!context.can_write);text('roleLabel',`${context.access_level.toUpperCase()} · ${context.email}`);
  }catch(e){reset();text('accessStatus',messages[e.message]||'Entre no painel com senha e 2FA para continuar.')}
}
$('toggleArchived').addEventListener('click',()=>run(async()=>{includeArchived=!includeArchived;$('toggleArchived').setAttribute('aria-pressed',String(includeArchived));text('toggleArchived',includeArchived?'Ocultar arquivados':'Mostrar arquivados');await load()}));
$('filterForm').addEventListener('submit',e=>{e.preventDefault();run(load)});
const financeFields={legal_name:'legalName',document:'document',payee_name:'payeeName',pix_type:'pixType',pix_key:'pixKey',commission_percent:'commissionPercent',reason:'financialReason'};
function clearErrors(form){form.querySelectorAll('.field-error').forEach(e=>e.remove());form.querySelectorAll('[aria-invalid]').forEach(e=>{e.removeAttribute('aria-invalid');e.removeAttribute('aria-describedby')})}
function fieldErrors(form,errors,fields){clearErrors(form);for(const [key,message] of Object.entries(errors)){const input=$(fields[key]||key);const error=document.createElement('span');error.className='field-error';error.id=`${input.id}Error`;error.textContent=message;input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',error.id);input.after(error)}form.querySelector('[aria-invalid=true]')?.focus();return Object.keys(errors).length>0}
$('partnerForm').addEventListener('submit',e=>{e.preventDefault();const errors={};if($('publicName').value.trim().length<2)errors.publicName='Informe o nome público (mínimo 2 caracteres).';if(!$('contactEmail').validity.valid)errors.contactEmail='Informe um e-mail válido.';if(fieldErrors($('partnerForm'),errors,{}))return;run(async()=>{
  const id=await rpc('admin_save_partner',{p_id:$('partnerId').value||null,p_data:{public_name:$('publicName').value.trim(),partner_type:$('partnerType').value,city:$('city').value.trim(),description:$('description').value.trim(),email:$('contactEmail').value.trim(),phone:$('contactPhone').value.trim(),contact_name:$('contactName').value.trim()}});
  selected={id};await load();clearFinance();financeState();$('partnerId').value=id;hide('financialSection',context.access_level!=='owner');text('status',context.access_level==='owner'?(selected.financial_ready?'Cadastro salvo. Configuração financeira preservada.':'Cadastro salvo. Complete o financeiro abaixo para ativar.'):'Cadastro salvo. Aguardando aprovação do OWNER.');if(context.access_level==='owner')$('financialSection').scrollIntoView({behavior:'smooth',block:'start'});
})});
$('newPartner').addEventListener('click',()=>{$('partnerForm').reset();clearErrors($('partnerForm'));$('partnerId').value='';selected=null;clearFinance();hide('financialSection');text('editTitle','Cadastrar parceiro')});
function openStepup(){hide('stepupPasswordForm',false);hide('stepupTotpForm');text('stepupStatus','');$('stepup').showModal()}
async function finishFinance(request,ticket=null){
  await rpc('admin_configure_partner',{p_id:request.id,p_payload:request.payload,p_ticket:ticket});
  clearFinance();if($('stepup').open)$('stepup').close();
  text('status','Configuração financeira salva.');
  if(request.activate){try{await rpc('admin_set_partner_status',{p_id:request.id,p_status:'active',p_reason:'cadastro_concluido'});text('status','Parceiro ativado. Link e código disponíveis.')}catch(e){await load();financeState();text('status',`Financeiro salvo. ${errorText(e)}`);return}}
  await load();financeState();
}
$('financialForm').addEventListener('submit',e=>{e.preventDefault();if(!selected||context?.access_level!=='owner'||busy)return;
  const payload={reason:$('financialReason').value};
  for(const [key,id] of Object.entries(financeFields))if(key!=='reason'&&!$(id).disabled){
    if(key==='commission_percent'&&selected.financial_ready&&$('commissionPercent').value!==''&&Number($('commissionPercent').value)===Number(selected.commission_percent))continue;
    payload[key]=key==='document'?normalizeDocument($(id).value):key==='pix_key'?normalizePix($('pixType').value,$(id).value):$(id).value.trim();
  }
  if(fieldErrors($('financialForm'),financialErrors(payload,{partial:!!selected.financial_ready}),financeFields))return;
  if(Object.keys(payload).length===1){text('status',messages.PARTNER_NO_CHANGES);return}
  const activate=e.submitter?.value==='activate';
  if(activate&&(!selected.contact?.email||!selected.contact?.phone)){const errors={};if(!selected.contact?.email)errors.contactEmail='Salve um e-mail antes de ativar.';if(!selected.contact?.phone)errors.contactPhone='Salve um telefone antes de ativar.';fieldErrors($('partnerForm'),errors,{});return}
  pending={id:selected.id,payload,activate};
  if(selected.requires_stepup){openStepup();return}
  run(async()=>{try{await finishFinance(pending)}catch(e){if(e.message==='PARTNER_STEPUP_REQUIRED'){openStepup();return}if(e.code==='23505'){fieldErrors($('financialForm'),{document:'CPF/CNPJ já cadastrado para outro parceiro.'},financeFields);return}throw e}});
});
$('stepupPasswordForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
  try{
    const expected=context.email;
    reauthClient=globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'pepday-partner-stepup-memory'}});
    const {data,error}=await reauthClient.auth.signInWithPassword({email:expected,password:$('stepupPassword').value});$('stepupPassword').value='';if(error||data.user?.email?.toLowerCase()!==expected.toLowerCase())throw new Error('REAUTH_FAILED');
    const factors=await reauthClient.auth.mfa.listFactors();if(factors.error)throw factors.error;factor=factors.data.totp.find(f=>f.status==='verified')?.id||'';if(!factor)throw new Error('MFA_REQUIRED');
    hide('stepupPasswordForm');hide('stepupTotpForm',false);text('stepupStatus','Informe um novo código do autenticador.');
  }catch(e){$('stepupPassword').value='';text('stepupStatus',errorText(e))}
})});
$('stepupTotpForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{
  try{
    const auth=await reauthClient.auth.mfa.challengeAndVerify({factorId:factor,code:$('stepupCode').value});$('stepupCode').value='';if(auth.error)throw auth.error;
    const promoted=await client.auth.setSession({access_token:auth.data.access_token,refresh_token:auth.data.refresh_token});if(promoted.error)throw promoted.error;reauthClient=null;
    const request=pending;if(!request)throw new Error('PARTNER_STEPUP_INVALID');
    const ticket=await rpc('admin_prepare_partner_stepup',{p_id:request.id,p_payload:request.payload});
    await finishFinance(request,ticket);
  }catch(e){$('stepupCode').value='';if(e.code==='23505'){$('stepup').close();fieldErrors($('financialForm'),{document:'CPF/CNPJ já cadastrado para outro parceiro.'},financeFields)}else text('stepupStatus',errorText(e))}
})});
$('cancelStepup').addEventListener('click',()=>{$('stepup').close();clearFinance();financeState()});
$('stepup').addEventListener('cancel',()=>{clearFinance();financeState()});
$('exit').addEventListener('click',()=>run(async()=>{await client.auth.signOut({scope:'local'});reset();text('accessStatus','Sessão encerrada.')}));
client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')reset()});
document.addEventListener('visibilitychange',()=>{if(document.hidden){$('stepupPassword').value='';$('stepupCode').value=''}});
init();
