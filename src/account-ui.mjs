import { config } from '../config.js';
import { initializeCloud, readPublicAuthSettings, loadAccountState, accountError } from './cloud.mjs';
import { reviewLegacy, readCloudInventory, completeLegacyImport } from './import-completion.mjs';
import { normalizeEntitlement, entitlementPresentation, postTrialExperience } from './entitlement.mjs';
import { createAccessController } from './access-control.mjs';
import { createSyncApi } from './sync-api.mjs';
import { createSyncEngine } from './sync-engine.mjs';
import { createTabCoordinator } from './tab-coordinator.mjs';
import { summarizeSync } from './sync-status.mjs';
import { readConfirmedSnapshot } from './remote-snapshot.mjs';
import { captureCardAcquisition, claimPendingCardAcquisition } from './acquisition.mjs';
import { enablePush, disablePush, pushInstallationStatus, savePushPreferences, notificationPermission } from './push.mjs';

const el = id => document.getElementById(id);
let cloud, state, generation = 0, busy = false, pendingEmail = '', methods = { email:false, google:false };
let importMode='import', importErrors=[];
let access=normalizeEntitlement(null), declinedTrial=false, postTrialDismissed=false, pushInviteDismissed=false, pushInstallationActive=null, syncEngine=null, currentRepository=null;
const {view:accessView,authority:accessAuthority}=createAccessController(document);
Object.defineProperty(globalThis,'PepDayAccess',{value:accessView,writable:false,configurable:false});
const repositoryScope=globalThis.PepDayRepositoryScope;
const later = new Set(); // por conta, somente nesta sessão; nenhum token/dado clínico aqui.
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
if(new URL(location.href).searchParams.get('from')==='cartao')captureCardAcquisition();
function hide(id, hidden = true) { el(id).classList.toggle('hidden',hidden); }
function status(text) { el('accountStatus').textContent = text; }
function publishAccess(raw, profileComplete=false) {
  if(raw?.signedIn===true)accessAuthority.authenticated(raw);
  else accessAuthority.signedOut();
  access=accessView.snapshot();
  const presentation=entitlementPresentation(access);
  el('planLabel').textContent=presentation.label;
  el('planDescription').textContent=presentation.description;
  const postTrial=postTrialExperience(access);
  if(!postTrial.visible)postTrialDismissed=false;
  el('postTrialTitle').textContent=postTrial.title||'Seu teste PRO terminou';
  el('postTrialMessage').textContent=postTrial.message||'Você continua no PepDay FREE. Seus dados PRO permanecem salvos.';
  el('postTrialViewPro').textContent=postTrial.primaryLabel||'Ver planos PRO';
  el('postTrialContinueFree').textContent=postTrial.secondaryLabel||'Continuar no FREE';
  hide('postTrialNotice',!postTrial.visible||postTrialDismissed);
  const canOffer=access.signedIn && profileComplete && access.status==='free' && access.trialAvailable && !declinedTrial;
  hide('trialActions',!canOffer);
  hide('trialBenefit',!canOffer);
  const showCommercial=access.signedIn && profileComplete && access.status!=='pro_active';
  hide('proOffer',!showCommercial);
  if(!showCommercial&&el('billingStatus'))el('billingStatus').textContent='';
}
function legalReady() {
  return Boolean(config.termsVersion && config.privacyVersion && config.termsUrl && config.privacyUrl &&
    [config.termsUrl,config.privacyUrl].every(value => {
      try { return new URL(value,location.href).protocol === 'https:'; } catch { return false; }
    }));
}
function profileLegalCurrent(profile){
  return Boolean(profile?.is_adult_confirmed && profile?.terms_accepted_at && profile?.privacy_accepted_at &&
    profile?.terms_version===config.termsVersion && profile?.privacy_version===config.privacyVersion);
}
function enableMethods() {
  el('accountGoogle').disabled = busy || !methods.google || !config.authRedirectUrl;
  el('accountSendCode').disabled = busy || !methods.email;
  el('accountSaveProfile').disabled = busy || !legalReady();
  el('accountStageImport').disabled = busy || importErrors.length>0 || !el('accountImportConsent').checked;
  document.querySelectorAll('[data-pro-plan]').forEach(button=>button.disabled=busy);
  if(el('promoRedeemButton'))el('promoRedeemButton').disabled=busy;
  if(el('promoCode'))el('promoCode').disabled=busy;
  if(el('accountExportData'))el('accountExportData').disabled=busy;
  if(el('accountDeleteOpen'))el('accountDeleteOpen').disabled=busy;
  if(el('accountDeleteCancel'))el('accountDeleteCancel').disabled=busy;
  ['pushEnable','pushSave','pushDisable'].forEach(id=>{if(el(id))el(id).disabled=busy});
  if(el('accountDeleteConfirmBtn'))el('accountDeleteConfirmBtn').disabled=
    busy || el('accountDeleteText').value.trim()!=='EXCLUIR';
}
function clearPrivateUi({preserveAccess=false}={}) {
  state = null; importErrors=[]; importMode='import'; pushInstallationActive=null; currentRepository=null;
  el('accountIdentity').textContent = '';
  if(!preserveAccess)publishAccess(null);
  el('accountProfileForm').reset();
  el('accountCode').value = '';
  el('accountImportConsent').checked = false;
  el('accountImportSummary').textContent = '';
  el('accountImportList').replaceChildren();
  el('accountImportIssues').textContent = '';
  if(el('accountDataStatus'))el('accountDataStatus').textContent='';
  if(el('pushStatus'))el('pushStatus').textContent='';
  if(el('pushSettings'))hide('pushSettings');
  if(el('pushInvite'))hide('pushInvite');
  if(el('pushRoutineDialog')?.open)el('pushRoutineDialog').close();
  if(el('promoStatus'))el('promoStatus').textContent='';
  if(el('promoCode'))el('promoCode').value='';
  if(el('accountDeleteText'))el('accountDeleteText').value='';
  if(el('accountDeleteConfirm'))hide('accountDeleteConfirm');
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
function dataStatus(message){
  if(el('accountDataStatus'))el('accountDataStatus').textContent=message||'';
}
function pushMessage(message){
  if(el('pushStatus'))el('pushStatus').textContent=message||'';
}
function renderPushInstallationState(active,{checking=false,unavailable=false}={}){
  pushInstallationActive=active===true?true:active===false?false:null;
  const permission=notificationPermission();
  hide('pushEnable',checking||pushInstallationActive===true||permission==='unsupported');
  hide('pushDisable',checking||pushInstallationActive!==true);
  if(checking){pushMessage('Conferindo o vínculo deste aparelho…');return}
  if(pushInstallationActive===true){pushMessage('Notificações ativadas neste aparelho.');return}
  if(unavailable){pushMessage('Não foi possível confirmar o vínculo deste aparelho agora. Tente novamente quando estiver online.');return}
  pushMessage(
    permission==='granted'?'Permissão do navegador concedida. Ative este aparelho para vinculá-lo à sua conta.':
    permission==='denied'?'Notificações estão bloqueadas nas configurações deste navegador.':
    permission==='unsupported'?'Este navegador não oferece Web Push compatível.':
    'Notificações ainda não foram autorizadas neste navegador.'
  );
}
function renderPushSettings(settings,complete){
  if(!el('pushSettings'))return;
  hide('pushSettings',!state||!complete);
  if(!state||!complete)return;
  el('pushRoutine').checked=settings?.routine_reminders===true;
  el('pushRefill').checked=settings?.refill_alerts===true;
  el('pushOperational').checked=settings?.operational_notices!==false;
  el('pushSecurity').checked=settings?.account_security_notices!==false;
  renderPushInstallationState(null,{checking:true});
}
function currentPushPreferences(){
  return {
    routine:el('pushRoutine').checked,
    refill:el('pushRefill').checked,
    operational:el('pushOperational').checked,
    security:el('pushSecurity').checked
  };
}
function renderPushInvite(complete){
  if(!el('pushInvite'))return;
  const show=Boolean(state&&complete&&!pushInviteDismissed&&notificationPermission()==='default');
  hide('pushInvite',!show);
}
async function enableReminderPush(statusTarget='pushInviteStatus'){
  const target=el(statusTarget);if(target)target.textContent='Ativando lembretes…';
  const result=await enablePush(cloud.client);
  if(result.outcome!=='registered'){
    if(target)target.textContent=result.outcome==='denied'?'Permissão negada pelo navegador.':result.outcome==='timeout'?'O Firebase demorou demais. Atualize a página e tente novamente.':'Não foi possível ativar neste navegador.';
    return false;
  }
  await savePushPreferences(cloud.client,{routine:true,refill:true,operational:true,security:true});
  ['pushRoutine','pushRefill','pushOperational','pushSecurity'].forEach(id=>{if(el(id))el(id).checked=true});
  renderPushInstallationState(true);
  pushInviteDismissed=true;hide('pushInvite');
  if(el('pushRoutineDialog')?.open)el('pushRoutineDialog').close();
  if(target)target.textContent='Lembretes ativados neste aparelho.';
  return true;
}
function downloadJson(data){
  const stamp=new Date().toISOString().slice(0,10);
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=`pepday-dados-${stamp}.json`;
  anchor.rel='noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
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
    const complete=profileLegalCurrent(next.profile);
    publishAccess({...next.entitlement,signedIn:true},complete);
    renderPushSettings(next.settings,complete);
    if(complete){
      pushInstallationStatus(cloud.client).then(result=>{
        if(current!==generation||!state)return;
        renderPushInstallationState(result.active,{unavailable:result.active===null});
      }).catch(error=>{
        if(current!==generation||!state)return;
        console.warn('PepDay status de push adiado:',error?.code||error?.name||'erro');
        renderPushInstallationState(null,{unavailable:true});
      });
    }
    renderPushInvite(complete);
    if(complete)claimPendingCardAcquisition(cloud.client).catch(error=>console.warn('PepDay attribution adiada:',error?.code||error?.name||'erro'));
    status(hydrationDelayed
      ?'Conta conectada. Os dados deste aparelho foram preservados; a leitura da conta será tentada novamente quando possível.'
      :'Conta conectada. Seus dados locais são salvos primeiro neste aparelho e sincronizados quando possível.');
    hide('accountProfileForm',complete);
    if (!complete) {
      const priorLegal=Boolean(next.profile.terms_accepted_at||next.profile.privacy_accepted_at);
      el('accountProfileTitle').textContent=priorLegal?'Revise os documentos atualizados':'Complete seu cadastro';
      el('accountName').value=next.profile.name || '';
      el('accountCountry').value=next.profile.country || 'BR';
      el('accountTimezone').textContent=`Fuso horário: ${timezone}`;
      if(priorLegal)status('Há uma versão atualizada dos Termos de Uso e da Política de Privacidade. Seus dados foram preservados; revise e aceite os documentos atuais para continuar usando os recursos da conta.');
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
  const previousUser=state?.user?.id;
  if(previousUser){try{await disablePush(cloud.client)}catch{}}
  ++generation;stopSync();clearPrivateUi();repositoryScope?.suspend();
  try { await cloud.account.logout(); }
  catch(error) { if(previousUser)startSync(await repositoryScope?.signedIn(previousUser));hide('accountSignedIn',false);throw error; }
  await repositoryScope?.signedOut();
  pendingEmail=''; el('accountEmailForm').reset(); el('accountEmail').readOnly=false;
  hide('accountCodeForm'); hide('accountSignedOut',false);
  status('Você saiu da conta. Os dados locais deste aparelho foram preservados.');
}));

el('pushInviteEnable').addEventListener('click',()=>run(async()=>{await enableReminderPush('pushInviteStatus')}));
el('pushInviteLater').addEventListener('click',()=>{pushInviteDismissed=true;hide('pushInvite')});
el('pushRoutineEnable').addEventListener('click',()=>run(async()=>{await enableReminderPush('pushRoutineStatus')}));
el('pushRoutineLater').addEventListener('click',()=>el('pushRoutineDialog')?.close());
window.addEventListener('pepday:first-routine-created',()=>{
  if(!state||notificationPermission()!=='default')return;
  const dialog=el('pushRoutineDialog');
  if(!dialog)return;
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
});

el('pushEnable').addEventListener('click',()=>run(async()=>{
  if(!state)return;
  pushMessage('Ativando neste aparelho…');
  const result=await enablePush(cloud.client);
  if(result.outcome!=='registered'){
    pushMessage(result.outcome==='denied'?'Permissão negada pelo navegador.':result.outcome==='timeout'?'O Firebase demorou demais para registrar este aparelho. Atualize a página e tente novamente.':'Não foi possível ativar neste navegador.');
    return
  }
  ['pushRoutine','pushRefill','pushOperational','pushSecurity'].forEach(id=>el(id).checked=true);
  await savePushPreferences(cloud.client,{routine:true,refill:true,operational:true,security:true});
  renderPushInstallationState(true);
}));

el('pushSave').addEventListener('click',()=>run(async()=>{
  if(!state)return;
  await savePushPreferences(cloud.client,currentPushPreferences());
  pushMessage('Preferências de notificações salvas.');
}));

el('pushDisable').addEventListener('click',()=>run(async()=>{
  if(!state)return;
  await disablePush(cloud.client);
  renderPushInstallationState(false);
}));

el('accountExportData').addEventListener('click',()=>run(async()=>{
  if(!state)throw new Error('Entre na conta para exportar seus dados.');
  dataStatus('Preparando seu arquivo…');
  try{await syncEngine?.trigger()}catch{}
  const data=await cloud.account.exportData();
  downloadJson(data);
  dataStatus('Exportação gerada. O arquivo contém os dados confirmados na sua conta.');
}));

el('accountDeleteOpen').addEventListener('click',()=>{
  if(busy||!state)return;
  el('accountDeleteText').value='';
  hide('accountDeleteConfirm',false);
  dataStatus('Revise o aviso e digite EXCLUIR para confirmar.');
  enableMethods();
  el('accountDeleteText').focus();
});

el('accountDeleteCancel').addEventListener('click',()=>{
  if(busy)return;
  el('accountDeleteText').value='';
  hide('accountDeleteConfirm');
  dataStatus('');
  enableMethods();
});

el('accountDeleteText').addEventListener('input',enableMethods);

el('accountDeleteConfirmBtn').addEventListener('click',()=>run(async()=>{
  if(!state||el('accountDeleteText').value.trim()!=='EXCLUIR')return;
  const repository=currentRepository;
  const userId=state.user.id;
  dataStatus('Excluindo sua conta com segurança…');
  const {data,error}=await cloud.client.functions.invoke('account-delete',{
    body:{confirm:'EXCLUIR'}
  });
  if(error||data?.code!=='ACCOUNT_DELETED'){
    dataStatus('Não foi possível excluir a conta agora. Nenhum dado local foi apagado.');
    if(error)throw error;
    throw new Error('Exclusão não confirmada.');
  }

  if(repository?.accountScope===`user:${userId}`)await repository.clearUserData();
  window.dispatchEvent(new CustomEvent('pepday:local-data-cleared',{detail:{reason:'account-deleted'}}));

  ++generation;stopSync();currentRepository=null;repositoryScope?.suspend();
  try{await cloud.account.logout()}catch{}
  await repositoryScope?.signedOut();
  clearPrivateUi();
  pendingEmail='';el('accountEmailForm').reset();el('accountEmail').readOnly=false;
  hide('accountCodeForm');hide('accountSignedOut',false);
  status('Conta excluída. Os dados vinculados a esta conta foram removidos e os dados locais deste aparelho foram limpos.');
}));
el('accountProfileForm').addEventListener('submit',event=>{
  event.preventDefault(); if (!legalReady() || !state) return;
  run(async()=>{
    await cloud.account.completeProfile({ name:el('accountName').value.trim(),country:el('accountCountry').value.toUpperCase(),
      timezone,adult:el('accountAdult').checked,termsAccepted:el('accountTerms').checked,privacyAccepted:el('accountPrivacy').checked,
      termsVersion:config.termsVersion,privacyVersion:config.privacyVersion,marketing:el('accountMarketing').checked });
    await refresh();
    if(notificationPermission()==='default'){
      document.querySelector('nav [data-go="home"]')?.click();
      requestAnimationFrame(()=>el('pushInvite')?.scrollIntoView({behavior:'smooth',block:'center'}));
    }
  });
});
function showProPlans(){
  document.querySelector('nav [data-go="profile"]')?.click();
  requestAnimationFrame(()=>el('proOffer')?.scrollIntoView({behavior:'smooth',block:'start'}));
}

function safeCheckoutUrl(value){
  try{
    const url=new URL(String(value||''));
    return url.protocol==='https:'&&(
      url.hostname==='mercadopago.com'||
      url.hostname.endsWith('.mercadopago.com')||
      url.hostname==='mercadopago.com.br'||
      url.hostname.endsWith('.mercadopago.com.br')
    )?url.href:null;
  }catch{return null}
}

el('promoRedeemForm').addEventListener('submit',event=>{
  event.preventDefault();
  if(busy)return;
  const code=el('promoCode').value.trim().toUpperCase();
  if(!code){el('promoStatus').textContent='Informe o código promocional.';return}
  run(async()=>{
    if(!state)throw new Error('Entre na sua conta antes de usar um código promocional.');
    el('promoStatus').textContent='Validando código…';
    const {data,error}=await cloud.client.rpc('redeem_promo_code',{p_code:code});
    if(error){el('promoStatus').textContent=error?.message||'Não foi possível aplicar este código.';return}
    const startsAt=data?.starts_at?new Date(data.starts_at):null;
    const endsAt=data?.ends_at?new Date(data.ends_at):null;
    const fmt=value=>value&&Number.isFinite(value.getTime())
      ?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(value):null;
    const starts=fmt(startsAt),ends=fmt(endsAt);
    const message=starts&&ends
      ?(startsAt.getTime()>Date.now()+60000
        ?`Código aplicado. Seu PRO promocional começa em ${starts} e vai até ${ends}.`
        :`Código aplicado. Seu PRO promocional está ativo até ${ends}.`)
      :'Código aplicado com sucesso.';
    await refresh();
    status(message);
  });
});

el('proOffer').addEventListener('click',event=>{
  const button=event.target.closest?.('button[data-pro-plan]');
  if(!button||busy)return;
  const plan=button.dataset.proPlan;
  run(async()=>{
    if(!state)throw new Error('Entre na sua conta antes de assinar o PepDay PRO.');
    el('billingStatus').textContent='Preparando checkout seguro…';
    const {data,error}=await cloud.client.functions.invoke('mercado-pago-checkout',{
      body:{plan,request_id:crypto.randomUUID()}
    });
    if(error){
      el('billingStatus').textContent='Não foi possível abrir o checkout agora. Tente novamente.';
      throw error;
    }
    const checkoutUrl=safeCheckoutUrl(data?.checkout_url);
    if(!checkoutUrl){
      el('billingStatus').textContent='O checkout retornou um endereço inválido.';
      throw new Error('Checkout inválido.');
    }
    el('billingStatus').textContent='Abrindo Mercado Pago…';
    location.assign(checkoutUrl);
  });
});

async function requestTrial() {
  if(!state){
    document.querySelector('nav [data-go="profile"]')?.click();
    status('Entre ou crie sua conta para começar o teste PRO gratuito.');
    return;
  }
  const complete=profileLegalCurrent(state.profile);
  if(!complete){
    document.querySelector('nav [data-go="profile"]')?.click();
    status('Conclua o cadastro e os aceites antes de começar o teste PRO.');
    return;
  }
  declinedTrial=false;
  await run(async()=>{await cloud.account.startTrial();await refresh();});
}
function startTrialFromTrustedClick(event){
  if(!event.isTrusted)return;
  if(access.status==='pro_expired'){showProPlans();return}
  requestTrial();
}
el('postTrialContinueFree').addEventListener('click',()=>{
  postTrialDismissed=true;
  hide('postTrialNotice');
});
el('postTrialViewPro').addEventListener('click',event=>{
  if(!event.isTrusted)return;
  document.querySelector('nav [data-go="profile"]')?.click();
  requestAnimationFrame(()=>el('proOffer')?.scrollIntoView({behavior:'smooth',block:'start'}));
});
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
