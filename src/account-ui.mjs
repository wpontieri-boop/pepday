import { config } from '../config.js';
import { initializeCloud, readPublicAuthSettings, loadAccountState, accountError } from './cloud.mjs';
import { reviewLegacy, readCloudInventory, completeLegacyImport } from './import-completion.mjs';
import { normalizeEntitlement, entitlementPresentation } from './entitlement.mjs';
import { createAccessController } from './access-control.mjs';
import { createSyncApi } from './sync-api.mjs';
import { createSyncEngine } from './sync-engine.mjs';
import { createTabCoordinator } from './tab-coordinator.mjs';
import { summarizeSync } from './sync-status.mjs';
import { readConfirmedSnapshot } from './remote-snapshot.mjs';

const el = id => document.getElementById(id);
let cloud, state, generation = 0, busy = false, pendingEmail = '', methods = { email:false, google:false };
let importMode='import', importErrors=[];
let access=normalizeEntitlement(null), declinedTrial=false, syncEngine=null, currentRepository=null;
const {view:accessView,authority:accessAuthority}=createAccessController(document);
Object.defineProperty(globalThis,'PepDayAccess',{value:accessView,writable:false,configurable:false});
const repositoryScope=globalThis.PepDayRepositoryScope;
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
function clearPrivateUi({preserveAccess=false}={}) {
  state = null; importErrors=[]; importMode='import'; currentRepository=null;
  el('accountIdentity').textContent = '';
  if(!preserveAccess)publishAccess(null);
  el('accountProfileForm').reset();
  el('accountCode').value = '';
  el('accountImportConsent').checked = false;
  el('accountImportSummary').textContent = '';
  el('accountImportList').replaceChildren();
  el('accountImportIssues').textContent = '';
  ['accountSignedIn','accountProfileForm','accountImport','accountImportReview','syncState'].forEach(id => hide(id));
}
function stopSync(){syncEngine?.stop();syncEngine=null}
async function renderSyncState(){
  const repository=currentRepository;if(!repository){hide('syncState');return}
  const rows=await repository.outbox.list();if(repository!==currentRepository)return;
  const summary=summarizeSync(rows,{online:navigator.onLine!==false,paused:Boolean(syncEngine?.paused),running:Boolean(syncEngine?.running)});
  el('syncLabel').textContent=summary.label;el('syncDescription').textContent=summary.description;hide('syncState',false);
  const conflicts=rows.filter(row=>row.status==='conflict'),list=el('syncConflictList');list.replaceChildren();
  for(const row of conflicts){
    const item=document.createElement('div');item.className='sync-conflict-item';
    const title=document.createElement('strong');title.textContent=(row.entityType==='vial'?'Frasco':row.entityType==='routine'?'Rotina':'Alteração')+' com conflito';
    const detail=document.createElement('p');detail.className='muted';
    detail.textContent=row.conflictData?.remote
      ?'A versão da conta mudou antes desta alteração ser sincronizada. Escolha qual versão deve prevalecer.'
      :'Este conflito precisa de revisão e não pode ser resolvido automaticamente.';
    const code=document.createElement('div');code.className='sync-conflict-code';code.textContent='Código: '+(row.lastErrorCode||'CONFLICT');
    item.append(title,detail,code);
    if(['vial','routine'].includes(row.entityType)&&row.conflictData?.remote){
      const actions=document.createElement('div');actions.className='account-actions';
      for(const [choice,label,klass] of [['remote','Usar versão da conta','ghost'],['local','Manter deste aparelho','secondary']]){
        const button=document.createElement('button');button.type='button';button.className=klass;
        button.dataset.conflictOperation=row.operationId;button.dataset.conflictChoice=choice;button.textContent=label;actions.append(button);
      }
      item.append(actions);
    }
    list.append(item);
  }
  hide('syncConflictReview',conflicts.length===0);
}
function startSync(repository){
  stopSync();currentRepository=repository||null;if(!repository){renderSyncState();return}
  const api=createSyncApi({client:cloud.client,config}),coordinator=createTabCoordinator({repository});
  syncEngine=createSyncEngine({repository,api,coordinator,onConfirmed:detail=>{
    window.dispatchEvent(new CustomEvent('pepday:sync-confirmed',{detail}));renderSyncState().catch(()=>{});
  }});
  renderSyncState().catch(()=>{});
  syncEngine.start().then(()=>renderSyncState()).catch(error=>{console.warn('PepDay sync adiada:',error?.code||error?.name||'erro');renderSyncState().catch(()=>{})});
}
window.addEventListener('pepday:outbox-ready',()=>syncEngine?.trigger().finally(()=>renderSyncState().catch(()=>{})));
window.addEventListener('online',()=>renderSyncState().catch(()=>{}));
window.addEventListener('offline',()=>renderSyncState().catch(()=>{}));
el('syncConflictList').addEventListener('click',event=>{
  const button=event.target.closest?.('button[data-conflict-operation]');if(!button||busy)return;
  run(async()=>{
    const repository=currentRepository;if(!repository)throw new Error('Repositório da conta indisponível.');
    const operationId=button.dataset.conflictOperation,choice=button.dataset.conflictChoice,row=await repository.outbox.get(operationId);
    if(!row||row.status!=='conflict')throw new Error('Este conflito já foi resolvido.');
    const options={choice};
    if(choice==='local'){
      options.newOperationId=crypto.randomUUID();
      if(row.entityType==='routine')options.newRoutineVersionId=crypto.randomUUID();
    }
    await repository.resolveEntityConflict(operationId,options);
    if(choice==='remote'){status('Versão da conta escolhida. Atualizando os dados confirmados…');await refresh();return}
    status('Versão deste aparelho escolhida. A alteração foi recriada sobre a versão atual da conta.');
    await syncEngine?.trigger();await renderSyncState();
  });
});
async function run(action) {
  if (busy) return;
  busy=true; enableMethods();
  try { await action(); } catch(error) { status(accountError(error)); }
  finally { busy=false; enableMethods(); }
}
async function refresh() {
  const current = ++generation;
  stopSync();clearPrivateUi({preserveAccess:true});
  repositoryScope?.suspend();
  if (!cloud) { await repositoryScope?.signedOut(); return; }
  const session = await cloud.account.session();
  if (current !== generation) return;
  hide('accountSignedOut',Boolean(session?.session));
  if (!session?.session) {
    publishAccess(null);
    await repositoryScope?.signedOut();
    if(current!==generation)return;
    status('Entre para acessar sua conta. A calculadora funciona sem login.'); return;
  }
  const repository=await repositoryScope?.signedIn(session.session.user.id);
  if(current!==generation)return;
  hide('accountSignedIn',false); // Sair continua acessível mesmo se o banco estiver indisponível.
  status('Conferindo sua conta…');
  try {
    const next = await loadAccountState(cloud.client,cloud.account);
    if (current !== generation) return;
    if (next.status !== 'signed_in') { publishAccess(null); hide('accountSignedIn'); hide('accountSignedOut',false); return; }
    state=next;
    let hydrationDelayed=false;
    if(repository?.accountScope===`user:${next.user.id}`){
      try{
        const snapshot=await readConfirmedSnapshot(cloud.client,next.user.id);
        if(current!==generation)return;
        await repository.hydrateConfirmedSnapshot(snapshot);
        if(current!==generation)return;
        window.dispatchEvent(new CustomEvent('pepday:sync-confirmed',{detail:{accountScope:repository.accountScope,source:'remote-hydration'}}));
      }catch(error){
        hydrationDelayed=true;
        console.warn('PepDay snapshot remoto adiado:',error?.code||error?.name||'erro');
      }
    }
    startSync(repository);
    el('accountIdentity').textContent = next.user.email || 'Conta conectada';
    const complete = next.profile.is_adult_confirmed && next.profile.terms_accepted_at && next.profile.privacy_accepted_at;
    publishAccess({...next.entitlement,signedIn:true},Boolean(complete));
    status(hydrationDelayed
      ?'Conta conectada. Os dados deste aparelho foram preservados; a leitura da conta será tentada novamente quando possível.'
      :'Conta conectada. Seus dados locais são salvos primeiro neste aparelho e sincronizados quando possível.');
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
  const previousUser=state?.user?.id;++generation;stopSync();clearPrivateUi();repositoryScope?.suspend();
  try { await cloud.account.logout(); }
  catch(error) { if(previousUser)startSync(await repositoryScope?.signedIn(previousUser));hide('accountSignedIn',false);throw error; }
  await repositoryScope?.signedOut();
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
  status('Dados da conta mantidos. A cópia local não foi enviada nem substituída. A sincronização continua respeitando suas escolhas e o estado local.');
});
el('accountImportLater').addEventListener('click',()=>{if(state)later.add(state.user.id);hide('accountImport');});
el('accountStageImport').addEventListener('click',()=>{
  if (!state || !el('accountImportConsent').checked) return;
  const userId=state.user.id, current=generation;
  run(async()=>{
    const result=await completeLegacyImport(cloud.client,localStorage,{consent:true,expectedUserId:userId,mode:importMode});
    if (current!==generation) return;
    status(result.status==='empty'?'Não há dados locais para guardar.':'Importação concluída e conferida. Cópia local e histórico legado preservados. Alterações futuras seguem a sincronização local-first.');
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
  cloud.account.onChange((_event,session)=>{
    ++generation; clearPrivateUi({preserveAccess:Boolean(session)});
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
