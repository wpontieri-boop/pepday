import { config } from '../../config.js';

const $=id=>document.getElementById(id);
const hide=(id,value=true)=>$(id)?.classList.toggle('hidden',value);
const setText=(id,value)=>{if($(id))$(id).textContent=String(value??'—')};
const fmt=n=>new Intl.NumberFormat('pt-BR').format(Number(n||0));
const fmtPercent=n=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(n||0))+'%';

if(!globalThis.supabase?.createClient) throw new Error('SDK Supabase indisponível.');
const client=globalThis.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey,{
  auth:{
    flowType:'pkce',
    persistSession:true,
    autoRefreshToken:true,
    detectSessionInUrl:true,
    storageKey:`pepday-test-${config.projectRef}-auth`
  }
});

let days=30;
let busy=false;

function authStatus(message){setText('authStatus',message)}
function setBusy(value){
  busy=value;
  document.querySelectorAll('button').forEach(button=>button.disabled=value);
}

async function currentUser(){
  const {data,error}=await client.auth.getUser();
  if(error&&error.name!=='AuthSessionMissingError')throw error;
  return data?.user||null;
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
  setText('cardTrialRate',fmtPercent(data.card_to_trial_percent));
  setText('cardPaidRate',fmtPercent(data.card_to_paid_percent));
  const stamp=data.generated_at?new Date(data.generated_at):null;
  setText('generatedAt',stamp&&Number.isFinite(stamp.getTime())
    ?`Atualizado em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium'}).format(stamp)} • janela de ${data.window_days} dias.`
    :'');
}

async function loadMetrics(){
  if(busy)return;
  setBusy(true);
  try{
    const user=await currentUser();
    if(!user){hide('dashboard');hide('authCard',false);authStatus('Entre para acessar o painel.');return}
    const {data,error}=await client.rpc('get_admin_acquisition_metrics',{p_days:days});
    if(error)throw error;
    hide('authCard');
    hide('dashboard',false);
    renderMetrics(data);
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

$('refresh')?.addEventListener('click',loadMetrics);
$('logout')?.addEventListener('click',async()=>{
  if(busy)return;setBusy(true);
  try{await client.auth.signOut({scope:'local'})}finally{
    setBusy(false);hide('dashboard');hide('authCard',false);hide('emailForm',false);hide('codeForm');authStatus('Sessão encerrada.');
  }
});

client.auth.onAuthStateChange(()=>queueMicrotask(loadMetrics));
loadMetrics();
