import { proGateDecision } from './entitlement.mjs';

const dialog = document.getElementById('proGateDialog');
const title = document.getElementById('proGateTitle');
const message = document.getElementById('proGateMessage');
const start = document.getElementById('proGateStart');
const close = document.getElementById('proGateClose');
const accessControl=globalThis.PepDayAccess;
const currentAccess=()=>accessControl?.snapshot?.()||Object.freeze({status:'free',pro:false,signedIn:false});

function setProtectedVisibility() {
  const allowed = proGateDecision(currentAccess()).allowed;
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
      : 'Rotinas, frascos e histórico fazem parte do PRO. Você pode testar por 7 dias, sem cartão.';
  start.classList.toggle('hidden',decision.reason === 'expired' || (!decision.canStartTrial && !decision.needsLogin));
  start.textContent = decision.needsLogin ? 'Entrar para começar' : 'Começar 7 dias grátis';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open','');
}

accessControl?.subscribe?.(setProtectedVisibility);
// Eventos DOM são somente notificações; o conteúdo de detail é deliberadamente ignorado.
document.addEventListener('pepday:entitlement',setProtectedVisibility);
document.addEventListener('pepday:pro-required',openDialog);

document.addEventListener('click',event=>{
  const action=event.target.closest?.('[data-pro-action]');
  if(!action || accessControl?.requirePro?.(action.dataset.proAction||'interface'))return;
  event.preventDefault();event.stopImmediatePropagation();
},true);

start?.addEventListener('click',()=>{
  const decision=proGateDecision(currentAccess());
  closeDialog();
  if(decision.needsLogin) document.querySelector('nav [data-go="profile"]')?.click();
  // O início real é tratado pelo módulo de conta e exige um clique confiável do navegador.
});
close?.addEventListener('click',closeDialog);
dialog?.addEventListener('click',event=>{if(event.target===dialog)closeDialog()});
setProtectedVisibility();
