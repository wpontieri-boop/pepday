import { config } from '../../config.js';

const $=id=>document.getElementById(id);
const hide=(id,value=true)=>$(id)?.classList.toggle('hidden',value);
const setText=(id,value)=>{if($(id))$(id).textContent=String(value??'—')};
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const fmtPercent=n=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(n||0))+'%';
const fmtDate=value=>{
  if(!value)return 'sem validade';
  const date=new Date(value);
  return Number.isFinite(date.getTime())
    ?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(date)
    :'—';
};

if(!globalThis.supabase?.createClient) throw new Error('SDK Supabase indisponível.');
const client=globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{
  auth:{
    flowType:'pkce',
    persistSession:true,
    autoRefreshToken:true,
    detectSessionInUrl:true,
    storageKey:`pepday-${config.environment}-${config.projectRef}-auth`
  }
});

let days=30;
let busy=false;
let promoRows=[];

function authStatus(message){setText('authStatus',message)}
function promoStatus(message){setText('promoAdminStatus',message)}
function promoExpiryFromNow(days){
  const date=new Date();
  date.setDate(date.getDate()+Number(days||0));
  date.setSeconds(0,0);
  const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}
function syncPromoExpiry(){
  if($('promoAdminExpiry'))$('promoAdminExpiry').value=promoExpiryFromNow($('promoAdminDuration')?.value||30);
}
function setBusy(value){
  busy=value;
  document.querySelectorAll('button').forEach(button=>button.disabled=value);
}

async function currentUser(){
  const {data,error}=await client.auth.getUser();
  if(error&&error.name!=='AuthSessionMissingError')throw error;
  return data?.user||null;
}

function renderPwaMetrics(data){
  setText('pwaDetectedInstalls',fmt(data?.detected_installs));
  setText('pwaActiveDevices',fmt(data?.active_installed_devices));
  setText('pwaStandaloneLaunches',fmt(data?.standalone_launches));
}

function renderCardCampaign(data){
  setText('cardBenefitGranted',fmt(data?.grants_started));
  setText('cardBenefitUsed',fmt(data?.grants_used));
  setText('cardBenefitActive',fmt(data?.grants_active_now));
  setText('cardBenefitEnded',fmt(data?.grants_ended));
  setText('cardBenefitPaid',fmt(data?.paid_after_grant));
  setText('cardBenefitPlans',`${fmt(data?.paid_monthly_after_grant)} / ${fmt(data?.paid_annual_after_grant)}`);
  setText('cardTrialRate',fmtPercent(data?.qr_to_grant_percent));
  setText('cardPaidRate',fmtPercent(data?.grant_to_paid_percent));
}

function renderMetrics(data){
  setText('newAccounts',fmt(data.new_accounts));
  setText('cardAccounts',fmt(data.card_accounts));
  setText('otherAccounts',fmt(data.other_accounts));
  setText('trialsStarted',fmt(data.trials_started));
  setText('cardTrials',`${fmt(data.card_trials)} via cartão`);
  setText('paidConversions',fmt(data.paid_conversions));
  setText('cardPaid',`${fmt(data.card_paid_conversions)} via cartão`);
  setText('paidActive',fmt(data.paid_active_now));
  setText('totalUsers',fmt(data.total_users_now));
  setText('freeNow',fmt(data.free_now));
  setText('trialActive',fmt(data.trial_active_now));
  setText('trialEnding',fmt(data.trial_ending_3d_now));
  setText('trialExpired',fmt(data.trial_expired_no_pro_now));
  setText('recoveryEligible',fmt(data.recovery_eligible_now));
  setText('monthlyActive',fmt(data.monthly_active_now));
  setText('annualActive',fmt(data.annual_active_now));
  setText('graceActive',fmt(data.grace_active_now));
  setText('cancelScheduled',fmt(data.cancel_scheduled_now));
  setText('proExpired',fmt(data.pro_expired_now));
  setText('cancellationsWindow',fmt(data.cancellations_in_window));
  setText('cancellationsWindowLabel',`nos últimos ${data.window_days} dias`);
  setText('recoverySummary',fmt(data.recovery_eligible_now));
  setText('campaignRecovered',data.recovered_campaign_available?'0':'—');
  setText('revenueReceived',data.revenue_available?'R$ 0,00':'—');
  const stamp=data.generated_at?new Date(data.generated_at):null;
  setText('generatedAt',stamp&&Number.isFinite(stamp.getTime())
    ?`Atualizado em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium'}).format(stamp)} • janela de ${data.window_days} dias.`
    :'');
}

function renderPromoCodes(rows){
  const list=$('promoCodeList');if(!list)return;
  list.replaceChildren();
  const query=($('promoCodeSearch')?.value||'').trim().toUpperCase();
  const filtered=Array.isArray(rows)?rows.filter(row=>!query||String(row.code||'').toUpperCase().includes(query)):[];
  if(filtered.length===0){
    const empty=document.createElement('p');empty.className='muted';
    empty.textContent=query?'Nenhum código encontrado.':'Nenhum código promocional criado ainda.';
    list.append(empty);return;
  }
  const statusLabel={available:'DISPONÍVEL',used:'UTILIZADO',expired:'EXPIRADO',disabled:'DESATIVADO'};
  for(const row of filtered){
    const card=document.createElement('article');card.className='promo-code-row';
    const head=document.createElement('div');head.className='promo-code-head';
    const code=document.createElement('strong');code.textContent=row.code;
    const badge=document.createElement('span');
    badge.textContent=statusLabel[row.status]||'—';
    badge.className=row.status==='available'?'active':'inactive';
    head.append(code,badge);
    const meta=document.createElement('p');
    meta.textContent=`${row.duration_days} dias • uso único • ${row.exclusive?'exclusivo • ':''}validade: ${fmtDate(row.expires_at)}`;
    const actions=document.createElement('div');actions.className='promo-code-actions';
    const copy=document.createElement('button');copy.type='button';copy.className='ghost';copy.dataset.promoCopy=row.code;copy.textContent='Copiar código';
    const uses=document.createElement('button');uses.type='button';uses.className='ghost';uses.dataset.promoUses=row.code;uses.textContent='Ver resgate';
    const toggle=document.createElement('button');toggle.type='button';toggle.dataset.promoToggle=row.code;toggle.dataset.promoActive=String(!row.active);
    toggle.textContent=row.active?'Desativar':'Ativar';
    if(row.status==='used'||row.status==='expired')toggle.disabled=true;
    actions.append(copy,uses,toggle);card.append(head,meta,actions);list.append(card);
  }
}

async function loadPromoCodes(){
  const {data,error}=await client.rpc('get_admin_promo_codes');
  if(error)throw error;
  promoRows=Array.isArray(data)?data:[];
  renderPromoCodes(promoRows);
}

async function showPromoRedemptions(code){
  const {data,error}=await client.rpc('get_admin_promo_redemptions',{p_code:code});
  if(error)throw error;
  setText('promoRedemptionsTitle',`Resgates — ${code}`);
  const list=$('promoRedemptionsList');list.replaceChildren();
  if(!Array.isArray(data)||data.length===0){
    const empty=document.createElement('p');empty.className='muted';empty.textContent='Nenhum resgate registrado.';list.append(empty);
  }else{
    for(const row of data){
      const item=document.createElement('div');item.className='promo-redemption-row';
      const identity=document.createElement('strong');identity.textContent=row.email||row.user_id;
      const detail=document.createElement('span');
      detail.textContent=`${row.name?row.name+' • ':''}resgatado em ${fmtDate(row.redeemed_at)} • acesso até ${fmtDate(row.ends_at)}`;
      item.append(identity,detail);list.append(item);
    }
  }
  hide('promoRedemptions',false);
}

async function loadMetrics(){
  if(busy)return;
  setBusy(true);
  try{
    const user=await currentUser();
    if(!user){hide('dashboard');hide('authCard',false);authStatus('Entre para acessar o painel.');return}
    const [acquisition,pwa,card]=await Promise.all([
      client.rpc('get_admin_acquisition_metrics',{p_days:days}),
      client.rpc('get_admin_pwa_metrics',{p_days:days}),
      client.rpc('get_admin_card_campaign_metrics',{p_days:days})
    ]);
    if(acquisition.error)throw acquisition.error;
    if(pwa.error)throw pwa.error;
    if(card.error)throw card.error;
    hide('authCard');
    hide('dashboard',false);
    renderMetrics(acquisition.data);
    renderPwaMetrics(pwa.data);
    renderCardCampaign(card.data);
    await loadPromoCodes();
  }catch(error){
    if(error?.code==='42501'){
      hide('dashboard');
      hide('authCard',false);
      authStatus('Esta conta não possui acesso administrativo ao painel.');
    }else{
      console.error('PepDay admin:',error?.code||error?.name||'erro');
      authStatus('Não foi possível carregar o painel agora.');
    }
  }finally{setBusy(false)}
}

$('emailForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const email=$('email').value.trim();
  setBusy(true);
  try{
    const {error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
    if(error)throw error;
    hide('emailForm');hide('codeForm',false);
    authStatus('Código enviado. Confira seu e-mail.');
  }catch(error){
    console.error('PepDay admin auth:',error?.code||error?.name||'erro');
    authStatus('Não foi possível enviar o código. Use uma conta PepDay já existente.');
  }finally{setBusy(false)}
});

$('codeForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const email=$('email').value.trim(),token=$('code').value.trim();
  if(!/^\d{6}$/.test(token)){authStatus('Informe o código de 6 dígitos.');return}
  setBusy(true);
  try{
    const {error}=await client.auth.verifyOtp({email,token,type:'email'});
    if(error)throw error;
    authStatus('');
    setBusy(false);
    await loadMetrics();
  }catch(error){
    console.error('PepDay admin verify:',error?.code||error?.name||'erro');
    authStatus('Código inválido ou expirado.');
  }finally{setBusy(false)}
});

document.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',async()=>{
  days=Number(button.dataset.days);
  document.querySelectorAll('[data-days]').forEach(item=>item.classList.toggle('active',item===button));
  await loadMetrics();
}));

document.querySelectorAll('[data-promo-preset]').forEach(button=>button.addEventListener('click',()=>{
  const value=button.dataset.promoPreset;
  $('promoAdminDuration').value=value;
  syncPromoExpiry();
  document.querySelectorAll('[data-promo-preset]').forEach(item=>item.classList.toggle('active',item===button));
}));
$('promoAdminDuration')?.addEventListener('change',syncPromoExpiry);
$('promoCodeSearch')?.addEventListener('input',()=>renderPromoCodes(promoRows));
syncPromoExpiry();

$('promoCreateForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const duration=Number($('promoAdminDuration').value);
  const expiry=$('promoAdminExpiry').value;
  const email=$('promoAdminEmail').value.trim();
  setBusy(true);promoStatus('Gerando código único…');
  try{
    const {data,error}=await client.rpc('admin_generate_promo_code',{
      p_duration_days:duration,
      p_expires_at:expiry?new Date(expiry).toISOString():null,
      p_exclusive_email:email||null
    });
    if(error)throw error;
    promoStatus(`${data.code} gerado com sucesso. Use “Copiar código” para enviar ao amigo.`);
    $('promoCreateForm').reset();$('promoAdminDuration').value='30';syncPromoExpiry();
    document.querySelectorAll('[data-promo-preset]').forEach(item=>item.classList.toggle('active',item.dataset.promoPreset==='30'));
    await loadPromoCodes();
  }catch(error){
    console.error('PepDay promo create:',error?.code||error?.name||'erro');
    promoStatus(error?.message||'Não foi possível criar o código.');
  }finally{setBusy(false)}
});

$('promoCodeList')?.addEventListener('click',async event=>{
  const copy=event.target.closest?.('button[data-promo-copy]');
  const uses=event.target.closest?.('button[data-promo-uses]');
  const toggle=event.target.closest?.('button[data-promo-toggle]');
  if(busy||(!copy&&!uses&&!toggle))return;
  setBusy(true);
  try{
    if(copy){
      await navigator.clipboard.writeText(copy.dataset.promoCopy);
      promoStatus(`${copy.dataset.promoCopy} copiado.`);
    }
    if(uses)await showPromoRedemptions(uses.dataset.promoUses);
    if(toggle){
      const code=toggle.dataset.promoToggle,active=toggle.dataset.promoActive==='true';
      const {error}=await client.rpc('admin_set_promo_code_active',{p_code:code,p_active:active});
      if(error)throw error;
      promoStatus(`${code} ${active?'ativado':'desativado'}.`);
      await loadPromoCodes();
    }
  }catch(error){
    console.error('PepDay promo admin:',error?.code||error?.name||'erro');
    promoStatus(error?.message||'Não foi possível concluir a ação.');
  }finally{setBusy(false)}
});

$('promoRedemptionsClose')?.addEventListener('click',()=>hide('promoRedemptions'));

$('refresh')?.addEventListener('click',loadMetrics);
$('logout')?.addEventListener('click',async()=>{
  if(busy)return;setBusy(true);
  try{await client.auth.signOut({scope:'local'})}finally{
    setBusy(false);hide('dashboard');hide('authCard',false);hide('emailForm',false);hide('codeForm');authStatus('Sessão encerrada.');
  }
});

client.auth.onAuthStateChange(()=>queueMicrotask(loadMetrics));
loadMetrics();
