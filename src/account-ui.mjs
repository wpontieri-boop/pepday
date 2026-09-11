import { config } from '../config.js';
import { initializeCloud, readPublicAuthSettings, loadAccountState, accountError } from './cloud.mjs';
import { reviewLegacy, readCloudInventory, completeLegacyImport } from './import-completion.mjs';
import { normalizeEntitlement, entitlementPresentation } from './entitlement.mjs';
import { createAccessController } from './access-control.mjs';

const el = id => document.getElementById(id);
let cloud, state, generation = 0, busy = false, pendingEmail = '', methods = { email:false, google:false };
let importMode='import', importErrors=[];
let access=normalizeEntitlement(null), declinedTrial=false;
const {view:accessView,authority:accessAuthority}=createAccessController(document);
Object.defineProperty(globalThis,'PepDayAccess',{value:accessView,writable:false,configurable:false});
const later = new Set(); // por conta, somente nesta sessão; nenhum token/dado clínico aqui.
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
function hide(id, hidden = true) { el(id).classList.toggle('hidden',hidden); }
function status(text) { el('accountStatus').textContent = text; }
function publishAccess(raw, profileComplete=false) {
  if(raw?.signedIn===true)accessAuthority.authenticated(raw);
  else accessAuthority.signedOut();
  access=accessView.snapshot();
  const presentation=entitlementPresentation(access);
  el('planLabel').textContent=presentation.label;
  el('planDescription').textContent=presentation.description;
  const canOffer=access.signedIn && profileComplete && access.status==='free' && access.trialAvailable && !declinedTrial;
  hide('trialActions',!canOffer);
}
function legalReady() {
  return Boolean(config.termsVersion && config.privacyVersion && config.termsUrl && config.privacyUrl &&
    [config.termsUrl,config.privacyUrl].every(value => {
      try { return new URL(value,location.href).protocol === 'https:'; } catch { return false; }
    }));
}
function enableMethods() {
  el('accountGoogle').disabled = busy || !methods.google || !config.authRedirectUrl;
  el('accountSendCode').disabled = busy || !methods.email;
  el('accountSaveProfile').disabled = busy || !legalReady();
  el('accountStageImport').disabled = busy || importErrors.length>0 || !el('accountImportConsent').checked;
}
function clearPrivateUi() {
  state = null; importErrors=[]; importMode='import';
  el('accountIdentity').textContent = '';
  publishAccess(null);
  el('accountProfileForm').reset();
  el('accountCode').value = '';
  el('accountImportConsent').checked = false;
  el('accountImportSummary').textContent = '';
  el('accountImportList').replaceChildren();
  el('accountImportIssues').textContent = '';
  ['accountSignedIn','accountProfileForm','accountImport','accountImportReview'].forEach(id => hide(id));
}
async function run(action) {
  if (busy) return;
  busy=true; enableMethods();
  try { await action(); } catch(error) { status(accountError(error)); }
  finally { busy=false; enableMethods(); }
}
async function refresh() {
  const current = ++generation;
  clearPrivateUi();
  if (!cloud) return;
  const session = await cloud.account.session();
  if (current !== generation) return;
  hide('accountSignedOut',Boolean(session?.session));
  if (!session?.session) { status('Entre para acessar sua conta. A calculadora funciona sem login.'); return; }
  hide('accountSignedIn',false); // Sair continua acessível mesmo se o banco estiver indisponível.
  status('Conferindo sua conta…');
  try {
    const next = await loadAccountState(cloud.client,cloud.account);
    if (current !== generation) return;
    if (next.status !== 'signed_in') { hide('accountSignedIn'); hide('accountSignedOut',false); return; }
    state=next;
    el('accountIdentity').textContent = next.user.email || 'Conta conectada';
    const complete = next.profile.is_adult_confirmed && next.profile.terms_accepted_at && next.profile.privacy_accepted_at;
    publishAccess({...next.entitlement,signedIn:true},Boolean(complete));
    status('Conta conectada. Os dados locais ainda não estão sincronizados.');
    hide('accountProfileForm',Boolean(complete));
    if (!complete) {
      el('accountName').value=next.profile.name || '';
      el('accountCountry').value=next.profile.country || 'BR';
      el('accountTimezone').textContent=`Fuso horário: ${timezone}`;
    }
    // Até os aceites serem reais, não enviar conteúdo potencialmente sensível.
    if (complete && !later.has(next.user.id)) {
      const legacy=reviewLegacy(localStorage);
      if (legacy.hasData) {
        const inventory=await readCloudInventory(cloud.client,next.user.id);
        if(current!==generation) return;
        importMode=inventory.hasData?'merge':'import'; importErrors=legacy.errors;
        el('accountImportSummary').textContent=`Neste aparelho: ${legacy.routines.length} rotina(s) e ${legacy.vials.length} frasco(s). Na conta: ${inventory.routines} rotina(s) e ${inventory.vials} frasco(s).`;
        el('accountStageImport').textContent=inventory.hasData?'Mesclar com segurança':'Importar meus dados';
        el('accountImportIssues').textContent=legacy.errors.length ? legacy.errors.join(' ') :
          'Os saldos atuais serão importados. O histórico, os dias já registrados e as alterações antigas serão preservados como legado, sem inventar informações ausentes. Registros conflitantes interrompem a operação inteira.';
        el('accountImportList').replaceChildren();
        for(const [type,items] of [['Frasco',legacy.vials],['Rotina',legacy.routines]]) {
          for(const item of items) {
            const row=document.createElement('li');
            row.textContent=type==='Frasco'?`${type}: ${item.name} — saldo ${item.remainingMg} mg`:
              `${type}: ${item.name} — ${item.doseValue} ${item.doseUnit}`;
            el('accountImportList').append(row);
          }
        }
        enableMethods();
        hide('accountImport',false);
      }
    }
  } catch(error) { if (current === generation) status(accountError(error)); }
}

el('accountEmailForm').addEventListener('submit',event=>{
  event.preventDefault();
  run(async()=>{
    const email=el('accountEmail').value.trim();
    await cloud.account.email(email);
    pendingEmail=email;
    hide('accountCodeForm',false);
    el('accountEmail').readOnly=true;
    status('Confira seu e-mail. Digite aqui o código de 6 dígitos recebido.');
    el('accountCode').focus();
  });
});
el('accountCodeForm').addEventListener('submit',event=>{
  event.preventDefault();
  run(async()=>{ await cloud.account.verifyCode(pendingEmail,el('accountCode').value); await refresh(); });
});
el('accountChangeEmail').addEventListener('click',()=>{
  if (busy) return;
  pendingEmail=''; el('accountEmail').readOnly=false; el('accountCode').value='';
  hide('accountCodeForm'); el('accountEmail').focus();
});
el('accountGoogle').addEventListener('click',()=>run(()=>cloud.account.google()));
el('accountLogout').addEventListener('click',()=>run(async()=>{
  ++generation; clearPrivateUi();
  try { await cloud.account.logout(); }
  catch(error) { hide('accountSignedIn',false); throw error; }
  pendingEmail=''; el('accountEmailForm').reset(); el('accountEmail').readOnly=false;
  hide('accountCodeForm'); hide('accountSignedOut',false);
  status('Você saiu da conta. Os dados locais deste aparelho foram preservados.');
}));
el('accountProfileForm').addEventListener('submit',event=>{
  event.preventDefault(); if (!legalReady() || !state) return;
  run(async()=>{
    await cloud.account.completeProfile({ name:el('accountName').value.trim(),country:el('accountCountry').value.toUpperCase(),
      timezone,adult:el('accountAdult').checked,termsAccepted:el('accountTerms').checked,privacyAccepted:el('accountPrivacy').checked,
      termsVersion:config.termsVersion,privacyVersion:config.privacyVersion,marketing:el('accountMarketing').checked });
    await refresh();
  });
});
async function requestTrial() {
  if(!state){
    document.querySelector('nav [data-go="profile"]')?.click();
    status('Entre ou crie sua conta para começar o teste PRO gratuito.');
    return;
  }
  const complete=state.profile.is_adult_confirmed && state.profile.terms_accepted_at && state.profile.privacy_accepted_at;
  if(!complete){
    document.querySelector('nav [data-go="profile"]')?.click();
    status('Conclua o cadastro e os aceites antes de começar o teste PRO.');
    return;
  }
  declinedTrial=false;
  await run(async()=>{await cloud.account.startTrial();await refresh();});
}
function startTrialFromTrustedClick(event){if(event.isTrusted)requestTrial()}
el('accountStartTrial').addEventListener('click',startTrialFromTrustedClick);
el('proGateStart').addEventListener('click',startTrialFromTrustedClick);
el('accountDeclineTrial').addEventListener('click',()=>{
  declinedTrial=true;hide('trialActions');
  status('Você continua no PepDay FREE. O teste só começará quando você escolher iniciar.');
});
el('accountReviewImport').addEventListener('click',()=>hide('accountImportReview',false));
el('accountImportConsent').addEventListener('change',enableMethods);
el('accountKeepCloud').addEventListener('click',()=>{
  if(!state) return; later.add(state.user.id); hide('accountImport');
  status('Dados da conta mantidos. A cópia local não foi enviada nem substituída. A sincronização das telas será disponibilizada no próximo bloco.');
});
el('accountImportLater').addEventListener('click',()=>{if(state)later.add(state.user.id);hide('accountImport');});
el('accountStageImport').addEventListener('click',()=>{
  if (!state || !el('accountImportConsent').checked) return;
  const userId=state.user.id, current=generation;
  run(async()=>{
    const result=await completeLegacyImport(cloud.client,localStorage,{consent:true,expectedUserId:userId,mode:importMode});
    if (current!==generation) return;
    status(result.status==='empty'?'Não há dados locais para guardar.':'Importação concluída e conferida. Cópia local e histórico legado preservados. A sincronização contínua será disponibilizada no próximo bloco.');
    hide('accountImport'); later.add(userId);
  });
});

try {
  if (!globalThis.supabase?.createClient) throw new Error('SDK indisponível');
  cloud=initializeCloud(globalThis.supabase.createClient,config,location.href);
  if (legalReady()) {
    el('accountTermsLink').href=config.termsUrl; el('accountPrivacyLink').href=config.privacyUrl;
    el('accountTerms').disabled=false; el('accountPrivacy').disabled=false; hide('legalStatus');
  }
  // Nunca aguardar chamadas Supabase dentro do callback de Auth (evita deadlock).
  cloud.account.onChange(()=>{
    ++generation; clearPrivateUi();
    setTimeout(()=>refresh().catch(error=>status(accountError(error))),0);
  });
  refresh().catch(error=>status(accountError(error)));
  readPublicAuthSettings(config).then(value=>{
    methods=value;
    el('googleStatus').textContent=value.google && config.authRedirectUrl
      ? '' : 'Google ainda não está disponível neste ambiente de testes.';
    enableMethods();
  }).catch(error=>status(accountError(error)));
} catch(error) {
  status('A conta ainda não está disponível neste endereço. Você pode continuar usando a calculadora.');
  el('googleStatus').textContent='Login não disponível.';
}
