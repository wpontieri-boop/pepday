import { proGateDecision } from './entitlement.mjs';

const dialog = document.getElementById('proGateDialog');
const title = document.getElementById('proGateTitle');
const message = document.getElementById('proGateMessage');
const start = document.getElementById('proGateStart');
const plans = document.getElementById('proGatePlans');
const close = document.getElementById('proGateClose');
let trialDeclinedThisSession=false;
const accessControl=()=>globalThis.PepDayAccess;
const currentAccess=()=>accessControl()?.snapshot?.()||Object.freeze({status:'free',pro:false,signedIn:false});

function setProtectedVisibility() {
  const access=currentAccess();
  if(!access.signedIn)trialDeclinedThisSession=false;
  const allowed = proGateDecision(access).allowed;
  document.querySelectorAll('[data-pro-content]').forEach(node => node.classList.toggle('hidden',!allowed));
  document.querySelectorAll('[data-pro-placeholder]').forEach(node => node.classList.toggle('hidden',allowed));
  if (!allowed && document.querySelector('.screen.active[data-pro-screen]')) {
    document.querySelector('nav [data-go="home"]')?.click();
  }
}

function closeDialog() {
  if (dialog?.open) dialog.close();
}

function openDialog() {
  const decision = proGateDecision(currentAccess());
  title.textContent = decision.reason === 'expired' ? 'Seu acesso PRO terminou' : 'Este é um recurso PepDay PRO';
  message.textContent = decision.reason === 'login'
    ? 'Entre ou crie sua conta para começar seu teste PRO gratuito. A calculadora continua disponível sem login.'
    : decision.reason === 'expired'
      ? 'Rotinas, frascos e histórico continuam salvos. Você pode continuar usando a calculadora FREE.'
      : trialDeclinedThisSession
        ? 'Rotinas, frascos e histórico fazem parte do PRO. Você pode continuar no FREE ou ver os planos quando quiser.'
        : 'Rotinas, frascos e histórico fazem parte do PRO. Você pode testar por 7 dias, sem cartão.';
  const commercial=decision.reason==='expired';
  const trialOffer=decision.reason==='free'&&decision.canStartTrial&&!trialDeclinedThisSession;
  start.classList.toggle('hidden',!commercial&&!trialOffer&&!decision.needsLogin);
  plans.classList.toggle('hidden',decision.needsLogin||commercial);
  start.textContent = commercial ? 'Ver planos' : decision.needsLogin ? 'Entrar para começar' : 'Começar 7 dias grátis';
  plans.textContent = trialDeclinedThisSession ? 'Ver planos PRO' : 'Assinar PRO';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open','');
}

accessControl()?.subscribe?.(setProtectedVisibility);
// Eventos DOM são somente notificações; o conteúdo de detail é deliberadamente ignorado.
document.addEventListener('pepday:entitlement',setProtectedVisibility);
document.addEventListener('pepday:pro-required',openDialog);

document.addEventListener('click',event=>{
  const action=event.target.closest?.('[data-pro-action]');
  if(!action || accessControl()?.requirePro?.(action.dataset.proAction||'interface'))return;
  event.preventDefault();event.stopImmediatePropagation();
},true);

start?.addEventListener('click',()=>{
  const decision=proGateDecision(currentAccess());
  closeDialog();
  if(decision.needsLogin) document.querySelector('nav [data-go="profile"]')?.click();
  if(decision.reason==='expired'){
    document.querySelector('nav [data-go="profile"]')?.click();
    requestAnimationFrame(()=>document.getElementById('proOffer')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  // O início real é tratado pelo módulo de conta e exige um clique confiável do navegador.
});
plans?.addEventListener('click',()=>{
  closeDialog();
  document.querySelector('nav [data-go="profile"]')?.click();
  requestAnimationFrame(()=>document.getElementById('proOffer')?.scrollIntoView({behavior:'smooth',block:'start'}));
});
close?.addEventListener('click',()=>{
  const decision=proGateDecision(currentAccess());
  if(decision.reason==='free'&&decision.canStartTrial)trialDeclinedThisSession=true;
  closeDialog();
});
dialog?.addEventListener('click',event=>{if(event.target===dialog)closeDialog()});
setProtectedVisibility();
