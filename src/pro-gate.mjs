import { normalizeEntitlement, proGateDecision } from './entitlement.mjs';

const dialog = document.getElementById('proGateDialog');
const title = document.getElementById('proGateTitle');
const message = document.getElementById('proGateMessage');
const start = document.getElementById('proGateStart');
const close = document.getElementById('proGateClose');
let access = normalizeEntitlement(null);

function setProtectedVisibility() {
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
  const decision = proGateDecision(access);
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

document.addEventListener('pepday:entitlement',event=>{
  access=normalizeEntitlement(event.detail,{signedIn:event.detail?.signedIn===true});
  setProtectedVisibility();
});

document.addEventListener('click',event=>{
  const action=event.target.closest?.('[data-pro-action]');
  if(!action || proGateDecision(access).allowed)return;
  event.preventDefault();event.stopImmediatePropagation();openDialog();
},true);

start?.addEventListener('click',()=>{
  const decision=proGateDecision(access);
  closeDialog();
  if(decision.needsLogin) document.querySelector('nav [data-go="profile"]')?.click();
  else if(decision.canStartTrial) document.dispatchEvent(new CustomEvent('pepday:start-trial'));
});
close?.addEventListener('click',closeDialog);
dialog?.addEventListener('click',event=>{if(event.target===dialog)closeDialog()});
setProtectedVisibility();
