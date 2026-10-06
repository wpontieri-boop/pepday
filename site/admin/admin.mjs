import { config } from '../../config.js';

const $=id=>document.getElementById(id);
const hide=(id,value=true)=>$(id)?.classList.toggle('hidden',value);
const setText=(id,value)=>{if($(id))$(id).textContent=String(value??'—')};
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const fmtPercent=n=>n==null?'—':new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(n))+'%';
const fmtMoney=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n));
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
    storageKey:`pepday-${config.environment}-${config.projectRef}-admin-auth`
  }
});

let days=30;
let busy=false;
let promoRows=[];
let adminContext=null;
let bootstrapEmail='';
let activeMfaFactorId='';

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

function authStage(stage='login'){
  hide('loginForm',stage!=='login');
  hide('firstAccess',stage!=='login');
  hide('bootstrapCodeForm',stage!=='bootstrap');
  hide('setPasswordForm',stage!=='password');
  hide('mfaEnroll',stage!=='mfa-enroll');
  hide('mfaChallengeForm',stage!=='mfa-challenge');
}

async function adminContextForSession(){
  const {data,error}=await client.rpc('get_admin_context');
  if(error)throw error;
  return data;
}

function applyAdminPermissions(){
  hide('partnersShortcut',config.environment!=='test'||config.projectRef!=='fsbqpyyprtymwrmzsacp');
  const level=adminContext?.access_level||'viewer';
  setText('adminRole',level.toUpperCase());
  setText('adminEmail',adminContext?.email||'—');
  hide('promoCreateForm',!adminContext?.can_write);
  hide('teamAdmin',!adminContext?.can_manage_team);
  if(!adminContext?.can_write){
    promoStatus('Modo VIEWER: consulta liberada; alterações administrativas estão bloqueadas.');
  }
}

async function beginMfa(context){
  adminContext=context;
  const listed=await client.auth.mfa.listFactors();
  if(listed.error)throw listed.error;
  const verified=(listed.data?.totp||[]).find(factor=>factor.status==='verified')||null;
  const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if(assurance.error)throw assurance.error;

  if(verified&&assurance.data?.currentLevel==='aal2'){
    adminContext=await adminContextForSession();
    await openDashboard();
    return;
  }

  if(verified){
    activeMfaFactorId=verified.id;
    authStage('mfa-challenge');
    authStatus('Informe o código do seu autenticador.');
    return;
  }

  const enrolled=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'PepDay Admin'});
  if(enrolled.error)throw enrolled.error;
  activeMfaFactorId=enrolled.data?.id||'';
  const qr=enrolled.data?.totp?.qr_code||'';
  const secret=enrolled.data?.totp?.secret||'';
  if(!activeMfaFactorId||!qr)throw new Error('MFA_ENROLL_INVALID');

  $('mfaQr').src=qr;
  if(secret){
    setText('mfaSecret',secret);
    hide('mfaSecretWrap',false);
  }
  authStage('mfa-enroll');
  authStatus('Configure o autenticador e confirme o primeiro código.');
}

async function afterPrimaryAuth({bootstrap=false}={}){
  const context=await adminContextForSession();

  if(bootstrap&&context.password_configured){
    await client.auth.signOut({scope:'local'});
    adminContext=null;
    authStage('login');
    authStatus('Este acesso já foi configurado. Entre com sua senha e 2FA.');
    return;
  }

  if(!context.password_configured){
    adminContext=context;
    authStage('password');
    authStatus('Defina sua senha administrativa para continuar.');
    return;
  }

  await beginMfa(context);
}

async function openDashboard(){
  adminContext=await adminContextForSession();
  if(adminContext?.aal!=='aal2')throw new Error('MFA_REQUIRED');
  hide('authCard');
  hide('dashboard',false);
  authStatus('');
  applyAdminPermissions();
  await loadMetrics();
}

async function resetAdminUi(message='Entre com sua senha para acessar o painel.'){
  adminContext=null;
  activeMfaFactorId='';
  bootstrapEmail='';
  hide('dashboard');
  hide('authCard',false);
  authStage('login');
  $('loginForm')?.reset();
  $('bootstrapCodeForm')?.reset();
  $('setPasswordForm')?.reset();
  $('mfaEnrollForm')?.reset();
  $('mfaChallengeForm')?.reset();
  authStatus(message);
}

function renderTeam(rows){
  const list=$('teamList');
  if(!list)return;
  list.replaceChildren();

  for(const row of Array.isArray(rows)?rows:[]){
    const card=document.createElement('div');
    card.className='team-row';

    const identity=document.createElement('div');
    const name=document.createElement('strong');
    name.textContent=row.name||row.email;
    const email=document.createElement('span');
    email.textContent=row.email;
    identity.append(name,email);

    const badge=document.createElement('span');
    badge.className=`team-badge ${row.access_level}`;
    badge.textContent=row.access_level.toUpperCase();
    card.append(identity,badge);

    if(row.access_level!=='owner'){
      const button=document.createElement('button');
      button.type='button';
      button.className='ghost';
      button.dataset.teamDisable=row.user_id;
      button.textContent=row.active?'Desativar':'Inativo';
      button.disabled=!row.active;
      card.append(button);
    }else{
      const fixed=document.createElement('span');
      fixed.textContent='OWNER protegido';
      card.append(fixed);
    }

    list.append(card);
  }
}

function renderAudit(rows){
  const list=$('auditList');
  if(!list)return;
  list.replaceChildren();
  const data=Array.isArray(rows)?rows:[];

  if(!data.length){
    const empty=document.createElement('p');
    empty.className='muted';
    empty.textContent='Nenhuma ação administrativa registrada.';
    list.append(empty);
    return;
  }

  for(const row of data){
    const item=document.createElement('div');
    item.className='audit-row';
    const text=document.createElement('div');
    const action=document.createElement('strong');
    action.textContent=String(row.action||'').replaceAll('_',' ');
    const detail=document.createElement('span');
    detail.textContent=`${row.actor_email||'—'}${row.target_email?' → '+row.target_email:''}`;
    text.append(action,detail);
    const when=document.createElement('span');
    when.textContent=fmtDate(row.created_at);
    item.append(text,when);
    list.append(item);
  }
}

async function loadTeam(){
  if(!adminContext?.can_manage_team)return;
  const [team,audit]=await Promise.all([
    client.rpc('get_admin_team'),
    client.rpc('get_admin_audit_logs',{p_limit:50})
  ]);
  if(team.error)throw team.error;
  if(audit.error)throw audit.error;
  renderTeam(team.data);
  renderAudit(audit.data);
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
  const ready=data?.metrics_version===2;
  setText('cardActivationBasis',ready?`${fmt(data.cohort_activated)} de ${fmt(data.cohort_attributed)} contas atribuídas no período`:'Base da taxa aguardando atualização');
  setText('cardConversionBasis',ready?`${fmt(data.cohort_paid)} de ${fmt(data.cohort_granted)} benefícios iniciados no período`:'Base da taxa aguardando atualização');
  setText('cardUsageBasis',ready?`primeiro uso no período • ${fmtPercent(data.grant_to_used_percent)} da coorte usaram`:'primeiro uso no período');
  if(!ready){setText('cardTrialRate','—');setText('cardPaidRate','—')}
}

function renderMetrics(data){
  setText('newAccounts',fmt(data.new_accounts));
  setText('cardAccounts',fmt(data.card_accounts));
  setText('otherAccounts',fmt(data.other_accounts));
  setText('trialsStarted',fmt(data.trials_started));
  setText('cardTrials',`${fmt(data.card_trials)} de origem cartão/QR • não inclui 30d`);
  setText('paidConversions',fmt(data.paid_conversions));
  setText('cardPaid',`${fmt(data.card_paid_conversions)} via cartão`);
  setText('paidActive',fmt(data.paid_active_now));
  setText('totalUsers',fmt(data.total_users_now));
  setText('freeNow',fmt(data.free_now));
  setText('basePaidActive',fmt(data.paid_active_now));
  setText('cardActiveNow',fmt(data.card_active_now));
  setText('promoActiveNow',fmt(data.promo_active_now));
  setText('trialActive',fmt(data.trial_active_now));
  setText('trialEnding',fmt(data.trial_ending_3d_now));
  setText('trialExpired',fmt(data.trial_expired_no_pro_now));
  setText('cardEnding',fmt(data.card_ending_3d_now));
  setText('cardExpired',fmt(data.card_expired_no_pro_now));
  setText('recoveryTrialDetail',`${fmt(data.recovery_trial_eligible_now)} com consentimento`);
  setText('recoveryCardDetail',`${fmt(data.recovery_card_eligible_now)} com consentimento`);
  setText('recoveryWithoutConsent',fmt(data.recovery_without_consent_now));
  setText('recoveryEligible',fmt(data.recovery_eligible_now));
  setText('monthlyActive',fmt(data.monthly_active_now));
  setText('annualActive',fmt(data.annual_active_now));
  setText('graceActive',fmt(data.grace_active_now));
  setText('cancelScheduled',fmt(data.cancel_scheduled_now));
  setText('proExpired',fmt(data.pro_expired_now));
  setText('cancellationsWindow',fmt(data.cancellations_in_window));
  setText('cancellationsWindowLabel',`nos últimos ${data.window_days} dias`);
  setText('recoverySummary',fmt(data.recovery_eligible_now));
  setText('campaignRecovered',data.recovered_campaign_available&&data.recovered_campaign_count!=null?fmt(data.recovered_campaign_count):'—');
  setText('approvedCharges',data.approved_charges_in_window==null?'—':fmt(data.approved_charges_in_window));
  setText('revenueReceived',data.revenue_available&&data.revenue_received!=null?fmtMoney(data.revenue_received):'—');
  setText('revenueDetail',data.revenue_available&&data.revenue_received!=null?'total informado pelos eventos financeiros':data.revenue_unavailable_reason||'valor financeiro ainda não disponível');
  const ready=data.metrics_version===2;
  setText('metricsStatus',ready?'':'Métricas de acesso e recuperação aguardam atualização do banco deste ambiente.');
  if(!ready){
    for(const id of ['freeNow','basePaidActive','cardActiveNow','promoActiveNow','trialActive','trialEnding','trialExpired','cardEnding','cardExpired','recoveryWithoutConsent','recoveryEligible','recoverySummary'])setText(id,'—');
    setText('recoveryTrialDetail','aguardando atualização');
    setText('recoveryCardDetail','aguardando atualização');
  }
  setText('environmentSummary',`Contas, cartão/QR, trial e conversão paga. Dados agregados do ambiente de ${config.environment==='production'?'produção':'homologação'}.`);
  setText('integrationsSummary',config.environment==='production'
    ?'Brevo e Mercado Pago configurados em produção. Oferta e automação de recuperação ainda pendentes.'
    :'Ambiente de homologação. Oferta e automação de recuperação ainda pendentes.');
  setText('windowSummary',`Eventos nos últimos ${data.window_days} dias. Base atual e elegibilidade independem do período selecionado.`);
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
    actions.append(copy,uses);
    if(adminContext?.can_write)actions.append(toggle);
    card.append(head,meta,actions);list.append(card);
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
  if(busy||!adminContext)return;
  setBusy(true);
  setText('metricsStatus','Atualizando indicadores…');
  try{
    const [acquisition,pwa,card]=await Promise.all([
      client.rpc('get_admin_acquisition_metrics',{p_days:days}),
      client.rpc('get_admin_pwa_metrics',{p_days:days}),
      client.rpc('get_admin_card_campaign_metrics',{p_days:days})
    ]);
    if(acquisition.error)throw acquisition.error;
    if(pwa.error)throw pwa.error;
    if(card.error)throw card.error;
    renderMetrics(acquisition.data);
    if(config.environment==='test')await loadRecoveryTest();
    if(config.environment==='production')await loadRecoveryProduction();
    renderPwaMetrics(pwa.data);
    renderCardCampaign(card.data);
    await loadPromoCodes();
    await loadTeam();
  }catch(error){
    console.error('PepDay admin:',error?.code||error?.name||'erro');
    if(error?.code==='42501'){
      await client.auth.signOut({scope:'local'});
      await resetAdminUi('Sua sessão administrativa expirou ou precisa de 2FA novamente.');
    }else{
      setText('metricsStatus','Não foi possível atualizar. Os números exibidos podem estar desatualizados; tente novamente.');
    }
  }finally{setBusy(false)}
}

async function loadRecoveryProduction(){
  const {data:m,error}=await client.rpc('get_admin_recovery_metrics',{p_days:days});
  if(error||!m)return;
  setText('campaignRecovered',fmt(m.recovered_campaign_count));
  setText('campaignRecoveredDetail',`${fmt(m.recovered_trial_count)} pós-trial • ${fmt(m.recovered_card_count)} pós-cartão • ${fmtMoney(m.recovery_revenue_first_cycle)} de receita confirmada da oferta${m.recovery_price_reset_pending?' • '+fmt(m.recovery_price_reset_pending)+' aguardando confirmação da renovação':''}`);
  setText('integrationsSummary',m.recovery_enabled&&m.recovery_provider_ready
    ?'Recuperação automática ativa em produção. Mensal: R$ 9,90 no primeiro mês; depois R$ 14,90/mês.'
    :m.recovery_provider_ready
      ?'Recuperação preparada em produção, mas os envios estão pausados.'
      :'Recuperação em produção aguardando configuração do provedor.');
  setText('recoverySendingPolicy',m.recovery_enabled
    ?'Automação ativa somente para contas elegíveis, com consentimento atual de marketing. Assinatura ou revogação interrompem a sequência.'
    :'Automação de recuperação pausada. Nenhuma nova mensagem promocional será reclamada enquanto estiver desativada.');
  hide('recoveryTestSelection',true);
}

async function loadRecoveryTest(){
  const [metrics,accounts]=await Promise.all([client.rpc('get_admin_recovery_metrics',{p_days:days}),client.rpc('list_recovery_test_candidates')]);
  if(metrics.error||accounts.error)return; // Older environments keep the approved dashboard.
  const m=metrics.data;
  setText('campaignRecovered',fmt(m.recovered_campaign_count));
  setText('campaignRecoveredDetail',`${fmt(m.recovered_trial_count)} pós-trial • ${fmt(m.recovered_card_count)} pós-cartão • ${fmtMoney(m.recovery_revenue_first_cycle)} de receita confirmada da oferta${m.recovery_price_reset_pending?' • '+fmt(m.recovery_price_reset_pending)+' aguardando confirmação da renovação':''}`);
  setText('integrationsSummary',m.recovery_provider_ready?'Recuperação disponível somente para testes em homologação. Mensal: R$ 9,90 no primeiro mês; depois R$ 14,90/mês.':'Recuperação em homologação: oferta aguarda validação do contrato financeiro.');
  setText('recoverySendingPolicy','Envio limitado às contas de teste selecionadas, com consentimento atual. Produção permanece sem automação de recuperação.');
  hide('recoveryTestSelection',false);
  const list=$('recoveryTestAccounts');list.replaceChildren();
  for(const account of accounts.data){
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=account.selected;
    check.disabled=adminContext?.access_level==='viewer';
    const stages={active:'sequência ativa',stopped:'sequência encerrada',completed:'sequência concluída',converted:'converteu para PRO'};
    const text=document.createElement('span');text.textContent=` ${account.email} • ${account.candidate.source==='card'?'cartão 30d':'trial 7d'}${account.status?' • '+(stages[account.status]||'em acompanhamento'):''}`;
    check.addEventListener('change',async()=>{
      check.disabled=true;const result=await client.rpc('select_recovery_test_account',{p_user_id:account.user_id,p_selected:check.checked});
      if(result.error){check.checked=!check.checked;setText('metricsStatus','Não foi possível alterar a seleção. Verifique seu acesso administrativo.');}
      check.disabled=false;
    });
    label.append(check,text);list.append(label,document.createElement('br'));
  }
  if(!accounts.data.length)list.textContent='Nenhuma conta com benefício de trial/cartão e consentimento válido disponível para seleção.';
}

$('loginForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const email=$('email').value.trim(),password=$('password').value;
  setBusy(true);authStatus('Entrando…');
  try{
    const {error}=await client.auth.signInWithPassword({email,password});
    if(error)throw error;
    await afterPrimaryAuth();
  }catch(error){
    console.error('PepDay admin password:',error?.code||error?.name||'erro');
    authStatus('E-mail, senha ou acesso administrativo inválido.');
  }finally{setBusy(false)}
});

$('firstAccess')?.addEventListener('click',async()=>{
  if(busy)return;
  const email=$('email').value.trim();
  if(!email){authStatus('Informe seu e-mail administrativo primeiro.');return}
  setBusy(true);
  try{
    const {error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false}});
    if(error)throw error;
    bootstrapEmail=email;
    authStage('bootstrap');
    authStatus('Código de primeiro acesso enviado. Confira seu e-mail.');
  }catch(error){
    console.error('PepDay admin bootstrap:',error?.code||error?.name||'erro');
    authStatus('Não foi possível iniciar o primeiro acesso para este e-mail.');
  }finally{setBusy(false)}
});

$('bootstrapCodeForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const token=$('bootstrapCode').value.trim();
  if(!/^\d{6}$/.test(token)){authStatus('Informe o código de 6 dígitos.');return}
  setBusy(true);
  try{
    const {error}=await client.auth.verifyOtp({email:bootstrapEmail,token,type:'email'});
    if(error)throw error;
    await afterPrimaryAuth({bootstrap:true});
  }catch(error){
    console.error('PepDay admin bootstrap verify:',error?.code||error?.name||'erro');
    authStatus('Código inválido, expirado ou conta sem acesso administrativo.');
  }finally{setBusy(false)}
});

$('setPasswordForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const password=$('newPassword').value,confirm=$('newPasswordConfirm').value;
  if(password.length<12){authStatus('Use uma senha com pelo menos 12 caracteres.');return}
  if(password!==confirm){authStatus('As senhas não coincidem.');return}
  setBusy(true);
  try{
    const updated=await client.auth.updateUser({password});
    if(updated.error)throw updated.error;
    const marked=await client.rpc('admin_mark_password_configured');
    if(marked.error)throw marked.error;
    const context=await adminContextForSession();
    await beginMfa(context);
  }catch(error){
    console.error('PepDay admin set password:',error?.code||error?.name||'erro');
    authStatus('Não foi possível salvar a senha administrativa.');
  }finally{setBusy(false)}
});

$('mfaEnrollForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const code=$('mfaEnrollCode').value.trim();
  if(!/^\d{6}$/.test(code)){authStatus('Informe o código de 6 dígitos do autenticador.');return}
  setBusy(true);
  try{
    const {error}=await client.auth.mfa.challengeAndVerify({factorId:activeMfaFactorId,code});
    if(error)throw error;
    await openDashboard();
  }catch(error){
    console.error('PepDay admin mfa enroll:',error?.code||error?.name||'erro');
    authStatus('Código 2FA inválido. Confira o autenticador e tente novamente.');
  }finally{setBusy(false)}
});

$('mfaChallengeForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const code=$('mfaChallengeCode').value.trim();
  if(!/^\d{6}$/.test(code)){authStatus('Informe o código de 6 dígitos do autenticador.');return}
  setBusy(true);
  try{
    const {error}=await client.auth.mfa.challengeAndVerify({factorId:activeMfaFactorId,code});
    if(error)throw error;
    await openDashboard();
  }catch(error){
    console.error('PepDay admin mfa challenge:',error?.code||error?.name||'erro');
    authStatus('Código 2FA inválido.');
  }finally{setBusy(false)}
});

$('teamForm')?.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!adminContext?.can_manage_team)return;
  const email=$('teamEmail').value.trim(),accessLevel=$('teamLevel').value;
  setBusy(true);setText('teamStatus','Preparando acesso administrativo…');
  try{
    const {data,error}=await client.functions.invoke('admin-team-invite',{body:{email,access_level:accessLevel}});
    if(error)throw error;
    if(!data?.ok)throw new Error(data?.code||'ADMIN_INVITE_FAILED');
    setText('teamStatus',`${email} configurado como ${accessLevel.toUpperCase()}. No primeiro acesso, a pessoa define senha e 2FA.`);
    $('teamForm').reset();
    await loadTeam();
  }catch(error){
    console.error('PepDay admin team:',error?.code||error?.name||'erro');
    setText('teamStatus','Não foi possível adicionar este membro agora.');
  }finally{setBusy(false)}
});

$('teamList')?.addEventListener('click',async event=>{
  const button=event.target.closest?.('button[data-team-disable]');
  if(!button||busy||!adminContext?.can_manage_team)return;
  setBusy(true);
  try{
    const {error}=await client.rpc('admin_disable_team_member',{p_user_id:button.dataset.teamDisable});
    if(error)throw error;
    setText('teamStatus','Acesso administrativo desativado.');
    await loadTeam();
  }catch(error){
    console.error('PepDay admin disable:',error?.code||error?.name||'erro');
    setText('teamStatus','Não foi possível desativar este membro.');
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
  event.preventDefault();if(busy||!adminContext?.can_write)return;
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
  if(toggle&&!adminContext?.can_write)return;
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
    setBusy(false);
    await resetAdminUi('Sessão encerrada.');
  }
});

client.auth.onAuthStateChange(event=>{
  if(event==='SIGNED_OUT')queueMicrotask(()=>resetAdminUi('Sessão encerrada.'));
});

(async()=>{
  try{
    const user=await currentUser();
    if(!user){await resetAdminUi();return}
    const context=await adminContextForSession();
    await beginMfa(context);
  }catch(error){
    console.error('PepDay admin init:',error?.code||error?.name||'erro');
    await client.auth.signOut({scope:'local'}).catch(()=>{});
    await resetAdminUi('Entre com sua senha para acessar o painel.');
  }
})();
