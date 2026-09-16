
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let routines=[],vials=[],confirmedApplications=[],outboxOperations=[],localRepository=null,localDataState='loading',localDataError='';
let lastCalc=null, editing=null, editingVial=null, vialReturnToRoutine=false;
let scopeGeneration=0,scopeTransition=Promise.resolve(null);
const applicationIntentInFlight=new Set();

function renderLocalData(){renderToday();renderRoutines();renderVials()}
function clearPrivateLocalUi(state='loading',message=''){
  routines=[];vials=[];confirmedApplications=[];outboxOperations=[];applicationIntentInFlight.clear();localRepository=null;localDataState=state;localDataError=message;
  editing=null;editingVial=null;vialReturnToRoutine=false;
  ['routineForm','vialForm','historyCard'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  if(['routines','vials'].includes(document.querySelector('.screen.active')?.id))go('home');
  renderLocalData();
}

const repositoryBase=(async()=>{
  if(globalThis.PepDayDisableRepositoryBootstrap===true)return null;
  const [{openDeviceRepository},{migrateLocalStorageToRepository}]=await Promise.all([
    import('./src/pepday-repository.mjs'),import('./src/local-data-migration.mjs')
  ]);
  const repository=await openDeviceRepository();
  let migration=null;
  try{migration=await migrateLocalStorageToRepository({repository,storage:localStorage})}
  catch(error){console.error('PepDay legacy migration:',error);alert('A cópia antiga não pôde ser migrada automaticamente. Ela foi preservada sem alterações. Os dados já conferidos neste aparelho continuam disponíveis.')}
  if(migration?.originChangedAfterMigration)alert('A cópia antiga foi migrada com sucesso, mas mudou em outra aba depois. O snapshot conferido continua preservado e a nova origem será revisada no próximo carregamento.');
  return {repository,deviceScope:repository.accountScope};
})();

function activateLocalScope(accountScope=null){
  const token=++scopeGeneration;
  clearPrivateLocalUi('loading');
  const transition=(async()=>{
    try{
      const base=await repositoryBase;
      if(!base)throw new Error('IndexedDB indisponível neste navegador.');
      const scope=accountScope||base.deviceScope;
      base.repository.setAccountScope(scope);
      const [nextRoutines,nextVials,nextApplications,loadedOutbox,draft]=await Promise.all([
        base.repository.routines.list(),base.repository.vials.list(),base.repository.applications.list(),base.repository.outbox.list(),base.repository.drafts.get('routine-form')
      ]);
      if(token!==scopeGeneration)return null;
      let nextOutbox=loadedOutbox;
      for(const operation of loadedOutbox.filter(item=>item.type==='application'&&item.blockedReason==='remote-prerequisites')){
        if(token!==scopeGeneration||base.repository.accountScope!==scope)return null;
        const routine=nextRoutines.find(item=>item.id===operation.payload?.localRoutineId),vial=nextVials.find(item=>item.id===operation.payload?.localVialId),remote=confirmedRemoteRefs(routine,vial);
        if(remote)await base.repository.outbox.resolvePrerequisites(operation.operationId,{payload:{...operation.payload,...remote}});
      }
      if(token!==scopeGeneration)return null;
      if(loadedOutbox.some(item=>item.blockedReason==='remote-prerequisites'))nextOutbox=await base.repository.outbox.list();
      if(token!==scopeGeneration)return null;
      routines=nextRoutines;vials=nextVials;confirmedApplications=nextApplications;outboxOperations=nextOutbox;
      if(draft)applyRoutineDraft(draft,{show:true});
      localRepository=base.repository;localDataState='ready';localDataError='';
      renderLocalData();return base.repository;
    }catch(error){
      console.error('PepDay local repository:',error);
      if(token===scopeGeneration)clearPrivateLocalUi('error','Os dados locais não puderam ser abertos. A cópia existente foi preservada.');
      return null;
    }
  })();
  scopeTransition=transition;return transition;
}

const repositoryReady=activateLocalScope();
const repositoryScopeAuthority=Object.freeze({
  suspend(){++scopeGeneration;scopeTransition=Promise.resolve(null);clearPrivateLocalUi('loading')},
  signedIn(userId){if(typeof userId!=='string'||!userId)return Promise.resolve(null);return activateLocalScope(`user:${userId}`)},
  // O escopo device é usado somente sem sessão. Ele nunca é copiado automaticamente para uma conta.
  signedOut(){return activateLocalScope(null)}
});
Object.defineProperty(globalThis,'PepDayRepositoryScope',{value:repositoryScopeAuthority,writable:false,configurable:false});

async function requireLocalRepository(){
  while(true){
    const transition=scopeTransition,repository=await transition;
    if(transition!==scopeTransition)continue;
    if(repository&&localDataState==='ready')return repository;
    alert(localDataError||'Os dados locais ainda estão sendo preparados. Nenhum dado foi alterado.');return null;
  }
}
async function localOperation(action){
  const token=scopeGeneration;
  try{const value=await action();return token===scopeGeneration?{ok:true,value}:{ok:false,stale:true}}
  catch(error){console.error('PepDay local operation:',error);alert('Não foi possível salvar os dados neste aparelho. Nenhuma alteração parcial foi mantida.');return {ok:false}}
}

function isoToday(){let d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function br(n,max=4){return Number(n).toLocaleString('pt-BR',{maximumFractionDigits:max})}
const proScreens=new Set(['routines','vials']);
function requirePro(context){return globalThis.PepDayAccess?.requirePro?.(context)===true}
function go(id){if(proScreens.has(id)&&!requirePro(`navigate:${id}`))return false;if(proScreens.has(id)&&localDataState!=='ready')return false;$$('.screen').forEach(x=>x.classList.toggle('active',x.id===id)); $$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.go===id)); window.scrollTo({top:0,behavior:'smooth'}); if(id==='home') renderToday(); if(id==='routines') renderRoutines(); if(id==='vials') renderVials();return true}
Object.defineProperty(window,'PepDayNavigation',{value:Object.freeze({go}),writable:false,configurable:false});
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));

function activeOn(r,date=new Date()){
  let start=new Date(r.start+'T00:00:00'), cur=new Date(date.getFullYear(),date.getMonth(),date.getDate());
  let diff=Math.floor((cur-start)/86400000); if(diff<0)return false;
  if(r.frequency==='daily')return true;
  if(r.frequency==='alternate')return diff%2===0;
  if(r.frequency==='5on2off')return diff%7<5;
  if(r.frequency==='weekdays')return (r.weekdays||[]).includes(cur.getDay());
  return false;
}
function freqLabel(r){
  if(r.frequency==='daily')return 'Todos os dias';
  if(r.frequency==='alternate')return 'Dia sim / dia não';
  if(r.frequency==='5on2off')return '5 dias ON / 2 dias OFF';
  if(r.frequency==='weekdays')return 'Dias específicos';
}
function renderToday(){
  let d=new Date(); $('#todayLabel').textContent=d.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
  if(localDataState!=='ready'){$('#todayRoutines').innerHTML=`<div class="empty"><p>${localDataState==='error'?localDataError:'Carregando dados locais…'}</p></div>`;return}
  let box=$('#todayRoutines'), list=routines.filter(r=>activeOn(r,d));
  if(!list.length){box.innerHTML='<div class="empty"><p>Nenhuma rotina programada para hoje.</p></div>';return}
  const day=isoToday();
  box.innerHTML=list.map(r=>{let app=confirmedApplications.find(item=>(item.localRoutineId===r.id||item.routine_id===r.id)&&item.scheduled_date===day&&!item.undone_at),
    intent=outboxOperations.find(item=>['application','undo'].includes(item.type)&&item.payload?.localRoutineId===r.id&&item.payload?.scheduledDate===day&&['pending','syncing','failed','conflict'].includes(item.status)),
    done=Boolean(app),v=vials.find(x=>x.id===r.vialId),label=intent?(intent.status==='conflict'?'Conflito — revisar':intent.status==='failed'?'Não enviado — revisar':intent.blockedReason?'Aguardando sincronização':intent.status==='syncing'?'Sincronizando…':'Pendente'):(done?'Desfazer':'Registrar');
    return `<div class="routine ${done?'done':''}"><div><h4>${esc(r.name)}</h4><p>${r.time?esc(r.time)+' • ':''}${br(r.doseValue,3)} ${r.doseUnit} • ${freqLabel(r)}${v?` • ${esc(v.name)}`:''}</p></div><div><div class="value">${br(r.ui,2)} UI</div><button data-pro-action onclick="toggleDone('${r.id}')"${intent?' disabled':''}>${label}</button></div></div>`}).join('');
}
function confirmedRemoteRefs(routine,vial){
 const rr=routine?.remoteRef,vr=vial?.remoteRef;
 return rr?.status==='synced'&&vr?.status==='synced'&&rr.id&&rr.versionId&&vr.id
   ?{routineId:rr.id,routineVersionId:rr.versionId,vialId:vr.id}:null;
}
async function toggleDone(id){
 if(!requirePro('application:toggle'))return false;
 if(localDataState!=='ready')return false;
 const routine=routines.find(x=>x.id===id);if(!routine)return false;
 const scheduledDate=isoToday(),key=`${id}:${scheduledDate}`;if(applicationIntentInFlight.has(key))return false;
 applicationIntentInFlight.add(key);
 try{
   let repository=await requireLocalRepository();if(!repository||!repository.accountScope.startsWith('user:'))return false;
   const token=scopeGeneration,accountScope=repository.accountScope,isCurrent=()=>token===scopeGeneration&&repository===localRepository&&repository.accountScope===accountScope;
   if(!isCurrent())return false;
   const durableOutbox=await repository.outbox.list();if(!isCurrent())return false;outboxOperations=durableOutbox;
   if(durableOutbox.some(item=>item.payload?.localRoutineId===id&&item.payload?.scheduledDate===scheduledDate&&['pending','syncing','failed','conflict'].includes(item.status)))return false;
   const application=confirmedApplications.find(item=>(item.localRoutineId===id||item.routine_id===id)&&item.scheduled_date===scheduledDate&&!item.undone_at);
   if(application){
     await repository.enqueueUndoIntent({operationId:crypto.randomUUID(),application,localRoutineId:id,localVialId:routine.vialId,scheduledDate});
   }else{
     const vial=vials.find(item=>item.id===routine.vialId),remote=confirmedRemoteRefs(routine,vial);
     if(!isCurrent())return false;
     await repository.enqueueApplicationIntent({operationId:crypto.randomUUID(),routine,vial,scheduledDate});
     if(!remote)alert('Registro guardado neste aparelho. Ele será enviado com o mesmo identificador quando Rotina e Frasco estiverem confirmados na conta.');
   }
   const nextOutbox=await repository.outbox.list();if(!isCurrent())return false;outboxOperations=nextOutbox;renderToday();window.dispatchEvent(new CustomEvent('pepday:outbox-ready',{detail:{accountScope}}));return true;
 }catch(error){console.error('PepDay application intent:',error?.code||error?.name||'erro');alert('Não foi possível guardar esta intenção. Nenhum saldo foi alterado.');return false}
 finally{applicationIntentInFlight.delete(key)}
}
window.toggleDone=toggleDone;

window.addEventListener('pepday:sync-confirmed',async event=>{
 const repository=localRepository,token=scopeGeneration;if(!repository||event.detail?.accountScope!==repository.accountScope)return;
 const [nextApplications,nextOutbox,nextVials]=await Promise.all([repository.applications.list(),repository.outbox.list(),repository.vials.list()]);
 if(token!==scopeGeneration||repository!==localRepository)return;
 confirmedApplications=nextApplications;outboxOperations=nextOutbox;vials=nextVials;renderLocalData();
});

$('#calculate').onclick=()=>{
 let mg=+$('#vialMg').value, water=+$('#waterMl').value, dose=+$('#dose').value;
 if(!mg||!water||!dose){alert('Preencha quantidade do frasco, diluente e quantidade informada.');return}
 let doseMg=$('#doseUnit').value==='mcg'?dose/1000:dose;
 if(doseMg>mg){alert('A quantidade informada é maior que o conteúdo total do frasco. Confira os valores.');return}
 let conc=mg/water, ml=doseMg/conc, ui=ml*100, doses=mg/doseMg;
 let syringeCapacity=+$('#syringe').value;
 lastCalc={name:$('#pepName').value||'Minha rotina',mg,water,dose,doseMg,ml,ui,conc,doses,syringeCapacity};
 $('#uiResult').textContent=br(ui,2)+' UI'; $('#mlResult').textContent=br(ml,4)+' mL'; $('#concResult').textContent=br(conc,3)+' mg/mL'; $('#dosesResult').textContent=br(doses,1);
 $('#fill').style.width=Math.min((ui/syringeCapacity)*100,100)+'%';
 $('#syringeNote').textContent=ui<=syringeCapacity
   ? `Marcação visual aproximada: ${br(ui,2)} UI em seringa U-100 de ${syringeCapacity} UI.`
   : `O volume equivale a ${br(ui,2)} UI e excede a capacidade da seringa selecionada (${syringeCapacity} UI).`;
 $('#result').classList.remove('hidden');
};
$('#resetCalc').onclick=()=>{['pepName','vialMg','waterMl','dose'].forEach(id=>$('#'+id).value='');$('#result').classList.add('hidden');lastCalc=null};
$('#saveRoutineFromCalc').onclick=()=>{if(!lastCalc)return; openRoutine(lastCalc);go('routines')};


function fillRoutineVials(selected=''){
  let sel=$('#rVial');
  sel.innerHTML='<option value="">Selecione um frasco</option>'+vials.map(v=>`<option value="${v.id}">${esc(v.name)} • ${br(v.remainingMg,3)} mg restantes</option>`).join('');
  sel.value=selected||'';
}
function calcRoutinePreview(){
  let v=vials.find(x=>x.id===$('#rVial').value), raw=+$('#rDose').value, unit=$('#rDoseUnit').value, cap=+$('#rSyringe').value;
  if(!v || raw<=0){$('#routineCalcPreview').classList.add('hidden'); return null}
  let doseMg=unit==='mcg'?raw/1000:raw, conc=v.initialMg/v.waterMl, ml=doseMg/conc, ui=ml*100;
  $('#routineCalcPreview').classList.remove('hidden');
  $('#rPreviewUi').textContent=br(ui,2)+' UI';
  $('#rPreviewMl').textContent=br(ml,4)+' mL';
  $('#rPreviewConc').textContent=br(conc,3)+' mg/mL';
  $('#rPreviewWarning').textContent=ui>cap?`Atenção: ${br(ui,2)} UI excede a capacidade da seringa selecionada (${cap} UI).`:'';
  $('#routineCalcPreview').classList.toggle('warning',ui>cap);
  return {doseMg,conc,ml,ui,cap,vial:v};
}
['rVial','rDose','rDoseUnit','rSyringe'].forEach(id=>document.addEventListener('input',e=>{if(e.target.id===id)calcRoutinePreview()}));

function openRoutine(calc=null,r=null){
 if(!requirePro(r?'routine:edit':'routine:create'))return false;
 if(localDataState!=='ready')return false;
 $('#routineForm').classList.remove('hidden'); editing=r?r.id:null; $('#routineFormTitle').textContent=r?'Editar rotina':'Nova rotina';
 $('#rName').value=r?.name||calc?.name||'';
 fillRoutineVials(r?.vialId||'');
 $('#rDose').value=r?.doseValue??'';
 $('#rDoseUnit').value=r?.doseUnit||'mg';
 $('#rSyringe').value=String(r?.syringeCapacity||100);
 $('#rRefillAt').value=String(r?.refillAt||3);
 $('#frequency').value=r?.frequency||'daily'; $('#startDate').value=r?.start||isoToday(); $('#rTime').value=r?.time||'';
 $$('#weekdaysBox input').forEach(c=>c.checked=(r?.weekdays||[]).includes(+c.value)); toggleWeekdays(); calcRoutinePreview();
}
function captureRoutineDraft(){return {id:'routine-form',editing,lastCalc,
  fields:{name:$('#rName').value,vialId:$('#rVial').value,dose:$('#rDose').value,doseUnit:$('#rDoseUnit').value,
    syringe:$('#rSyringe').value,refillAt:$('#rRefillAt').value,frequency:$('#frequency').value,
    startDate:$('#startDate').value,time:$('#rTime').value,
    weekdays:$$('#weekdaysBox input:checked').map(input=>+input.value)}}}
function applyRoutineDraft(draft,{show=false}={}){
 if(!draft?.fields)return false;
 editing=draft.editing||null;lastCalc=draft.lastCalc||lastCalc;
 $('#routineFormTitle').textContent=editing?'Editar rotina':'Nova rotina';
 $('#rName').value=draft.fields.name||'';fillRoutineVials(draft.fields.vialId||'');
 $('#rDose').value=draft.fields.dose??'';$('#rDoseUnit').value=draft.fields.doseUnit||'mg';
 $('#rSyringe').value=String(draft.fields.syringe||100);$('#rRefillAt').value=String(draft.fields.refillAt||3);
 $('#frequency').value=draft.fields.frequency||'daily';$('#startDate').value=draft.fields.startDate||isoToday();
 $('#rTime').value=draft.fields.time||'';
 $$('#weekdaysBox input').forEach(input=>input.checked=(draft.fields.weekdays||[]).includes(+input.value));
 toggleWeekdays();calcRoutinePreview();if(show)$('#routineForm').classList.remove('hidden');return true;
}
$('#newRoutine').onclick=()=>openRoutine(); $('#cancelRoutine').onclick=async()=>{let repository=await requireLocalRepository();if(!repository)return false;if(!(await localOperation(()=>repository.drafts.delete('routine-form'))).ok)return false;$('#routineForm').classList.add('hidden')};
$('#routineAddVial').onclick=async()=>{
 if(!requirePro('routine:create-vial'))return false;
 let repository=await requireLocalRepository();if(!repository)return false;
 if(!(await localOperation(()=>repository.drafts.put(captureRoutineDraft()))).ok)return false;
 vialReturnToRoutine=true;
 go('vials');
 openVial();
 $('#vialForm').scrollIntoView({behavior:'smooth'});
};
$('#frequency').onchange=toggleWeekdays;
function toggleWeekdays(){$('#weekdaysBox').classList.toggle('hidden',$('#frequency').value!=='weekdays')}
$('#saveRoutine').onclick=async()=>{
 if(!requirePro(editing?'routine:save-edit':'routine:save-create'))return false;
 if(localDataState!=='ready')return false;
 let repository=await requireLocalRepository();if(!repository)return false;
 let name=$('#rName').value.trim(), frequency=$('#frequency').value, start=$('#startDate').value, vialId=$('#rVial').value;
 let preview=calcRoutinePreview(), doseValue=+$('#rDose').value, doseUnit=$('#rDoseUnit').value, syringeCapacity=+$('#rSyringe').value, refillAt=+$('#rRefillAt').value;
 if(!name||!start||!vialId||!preview){alert('Confira nome, frasco, quantidade por aplicação e data.');return}
 if(preview.doseMg>preview.vial.remainingMg){alert('A quantidade por aplicação é maior que o saldo atual do frasco.');return}
 if(preview.ui>syringeCapacity){alert('O resultado excede a capacidade da seringa selecionada. Escolha uma seringa adequada ou confira os dados.');return}
 let weekdays=$$('#weekdaysBox input:checked').map(x=>+x.value);
 if(frequency==='weekdays'&&!weekdays.length){alert('Selecione ao menos um dia da semana.');return}

 let old=editing?routines.find(x=>x.id===editing):null;
 let doseHistory=old?.doseHistory||[];

 if(old){
   let changed =
     Math.abs((old.doseMg||0)-preview.doseMg)>1e-9 ||
     old.vialId!==vialId ||
     old.syringeCapacity!==syringeCapacity ||
     (old.refillAt||3)!==refillAt ||
     old.frequency!==frequency ||
     JSON.stringify(old.weekdays||[])!==JSON.stringify(weekdays||[]);
   if(changed){
     doseHistory=[{
       changedAt:new Date().toISOString(),
       previous:{
         doseValue:old.doseValue,
         doseUnit:old.doseUnit,
         doseMg:old.doseMg,
         ui:old.ui,
         ml:old.ml,
         vialId:old.vialId,
         syringeCapacity:old.syringeCapacity,
         refillAt:old.refillAt||3,
         frequency:old.frequency,
         weekdays:old.weekdays||[]
       },
       current:{
         doseValue,doseUnit,doseMg:preview.doseMg,ui:preview.ui,ml:preview.ml,
         vialId,syringeCapacity,refillAt,frequency,weekdays
       }
     },...doseHistory];
   }
 }

 let obj={
   id:editing||crypto.randomUUID(),
   name,vialId,doseValue,doseUnit,doseMg:preview.doseMg,
   ui:preview.ui,ml:preview.ml,syringeCapacity,refillAt,
   frequency,start,time:$('#rTime').value,weekdays,
   done:old?.done||[],
   doseHistory
 };
 if(!(await localOperation(()=>repository.saveRoutineWithOutbox(obj,{operationId:crypto.randomUUID(),type:editing?'edit':'create'}))).ok)return false;
 if(editing)routines=routines.map(x=>x.id===editing?obj:x); else routines.push(obj);
 $('#routineForm').classList.add('hidden');renderRoutines();renderToday();renderVials();
};
function renderRoutines(){
 let box=$('#routineList');if(localDataState!=='ready'){box.innerHTML=`<div class="card empty"><p>${localDataState==='error'?localDataError:'Carregando dados locais…'}</p></div>`;return} if(!routines.length){box.innerHTML='<div class="card empty"><p>Você ainda não salvou nenhuma rotina.</p></div>';return}
 box.innerHTML=routines.map(r=>{let v=vials.find(x=>x.id===r.vialId);return `<div class="routine"><div><h4>${esc(r.name)}</h4><p>${br(r.doseValue,3)} ${r.doseUnit} por aplicação • ${freqLabel(r)}${v?` • ${esc(v.name)}`:''}</p></div><div><div class="value">${br(r.ui,2)} UI</div><button onclick="editR('${r.id}')">Editar</button> <button onclick="delR('${r.id}')">Excluir</button></div></div>`}).join('');
}
window.editR=id=>openRoutine(null,routines.find(x=>x.id===id));
window.delR=async id=>{if(!requirePro('routine:delete')||localDataState!=='ready')return false;if(confirm('Excluir esta rotina?')){let repository=await requireLocalRepository();if(!repository)return false;if(!(await localOperation(()=>repository.deleteRoutineWithOutbox(id,{operationId:crypto.randomUUID()}))).ok)return false;routines=routines.filter(x=>x.id!==id);renderRoutines()}};
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function vialPct(v){return v.initialMg>0?Math.max(0,Math.min(100,(v.remainingMg/v.initialMg)*100)):0}

function closeFieldTooltips(except=null){
 document.querySelectorAll('.field-help[data-open="true"]').forEach(help=>{
   if(help===except)return;
   help.dataset.open='false';
   help.querySelector('.field-info')?.setAttribute('aria-expanded','false');
 });
}
document.addEventListener('click',event=>{
 const trigger=event.target.closest('.field-info');
 if(!trigger){closeFieldTooltips();return}
 event.preventDefault();event.stopPropagation();
 const help=trigger.closest('.field-help'),willOpen=help.dataset.open!=='true';
 closeFieldTooltips(help);help.dataset.open=String(willOpen);trigger.setAttribute('aria-expanded',String(willOpen));
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeFieldTooltips()});

function parseLocalDate(s){
  if(!s)return null;
  let [y,m,d]=s.split('-').map(Number);
  return new Date(y,m-1,d,12,0,0,0);
}
function fmtDate(d){return d?d.toLocaleDateString('pt-BR'):'—'}
function isRoutineDay(r,d){
  let start=parseLocalDate(r.start);
  if(!start || d<start)return false;
  let diff=Math.floor((d-start)/86400000);
  if(r.frequency==='daily')return true;
  if(r.frequency==='alternate')return diff%2===0;
  if(r.frequency==='5on2off')return diff%7<5;
  if(r.frequency==='weekdays')return (r.weekdays||[]).includes(d.getDay());
  return false;
}
function nextRoutineDates(r,count,from=new Date()){
  let dates=[],d=new Date(from.getFullYear(),from.getMonth(),from.getDate(),12),guard=0;
  let start=parseLocalDate(r.start);
  if(start && d<start)d=new Date(start);
  while(dates.length<count && guard<3660){
    if(isRoutineDay(r,d))dates.push(new Date(d));
    d.setDate(d.getDate()+1); guard++;
  }
  return dates;
}
function vialForecast(v){
  let linked=routines.filter(r=>r.vialId===v.id && r.doseMg>0);
  if(!linked.length)return null;
  let r=linked[0];
  let applications=Math.floor((v.remainingMg+1e-9)/r.doseMg);

  let today=new Date();
  let todayLocal=new Date(today.getFullYear(),today.getMonth(),today.getDate(),12);
  let todayIso=`${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}`;

  // Uma data só é futura/pendente se for dia da rotina e ainda não estiver registrada.
  function pendingDates(count){
    let dates=[],d=new Date(todayLocal),guard=0;
    let start=parseLocalDate(r.start);
    if(start && d<start)d=new Date(start);
    while(dates.length<count && guard<3660){
      let iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      let alreadyDone=(r.done||[]).includes(iso);
      if(isRoutineDay(r,d) && !alreadyDone)dates.push(new Date(d));
      d.setDate(d.getDate()+1); guard++;
    }
    return dates;
  }

  let dates=applications>0?pendingDates(applications):[];
  return {
    r,
    applications,
    next: dates.length?dates[0]:null,
    end: dates.length?dates[dates.length-1]:null
  };
}
function lastVialMovement(v){
  let h=(v.history||[]).find(x=>x.type==='dose' || x.type==='undo');
  if(!h)return '';
  let label=h.type==='dose'?'Última aplicação registrada':'Último registro desfeito';
  let amount=h.type==='dose'?`-${br(h.mg||0,3)} mg`:`+${br(h.mg||0,3)} mg`;
  return `<div class="last-movement">
    <small>${label}</small>
    <b>${new Date(h.date).toLocaleString('pt-BR')}</b>
    <span>${esc(h.routineName||'Rotina')} • ${br(h.ui||0,2)} UI • ${amount}</span>
  </div>`;
}
function forecastHtml(v){
  let f=vialForecast(v);
  if(!f)return `<div class="forecast-box"><div class="forecast-title"><b>Previsão do frasco</b></div><p class="forecast-note">Vincule este frasco a uma rotina para calcular aplicações restantes e data de término.</p></div>`;
  let rest=f.applications, refillAt=+(f.r.refillAt||3);
  let inAlert=rest<=refillAt;
  let alertText=rest<=0
    ?'Saldo insuficiente para uma aplicação completa.'
    :inAlert
      ?`⚠ Reposição: restam ${rest} aplicação${rest===1?'':'ões'}. Planeje a compra de um novo frasco.`
      :`Aviso de reposição programado para quando restarem ${refillAt} aplicações.`;
  return `<div class="forecast-box ${inAlert?'forecast-alert':''}">
    <div class="forecast-title"><b>Previsão do frasco</b><span>${esc(f.r.name)}</span></div>
    <div class="forecast-grid">
      <div><small>POR APLICAÇÃO</small><strong>${br(f.r.doseValue,3)} ${f.r.doseUnit||'mg'}</strong></div>
      <div><small>APLICAÇÕES RESTANTES</small><strong>${rest}</strong></div>
      <div><small>PRÓXIMA APLICAÇÃO</small><strong>${fmtDate(f.next)}</strong></div>
      <div><small>PREVISÃO DE TÉRMINO</small><strong>${fmtDate(f.end)}</strong></div>
    </div>
    <div class="refill-status ${inAlert?'active':''}">
      <small>ALERTA DE REPOSIÇÃO</small>
      <strong>${alertText}</strong>
    </div>
  </div>`;
}

function renderVials(){
 let box=$('#vialList');
 if(localDataState!=='ready'){box.innerHTML=`<div class="card empty"><p>${localDataState==='error'?localDataError:'Carregando dados locais…'}</p></div>`;return}
 if(!vials.length){
   box.innerHTML='<div class="card empty"><strong>🧪</strong><h3>Nenhum frasco cadastrado</h3><p>Cadastre um frasco para acompanhar concentração, data de reconstituição e saldo.</p></div>';
   return;
 }
 box.innerHTML=vials.map(v=>{
   let pct=vialPct(v),conc=v.initialMg/v.waterMl;
   return `<div class="card vial-card">
     <div class="vial-top">
       <div class="vial-identity">
         <div class="vial-visual premium-vial" aria-hidden="true">
           <div class="vial-cap">
             <div class="vial-cap-top"></div>
             <div class="vial-cap-rings"></div>
           </div>
           <div class="vial-neck"></div>
           <div class="vial-shoulder"></div>
           <div class="vial-glass">
             <div class="vial-liquid" style="height:${Math.max(10,pct)}%">
               <div class="vial-meniscus"></div>
               <div class="vial-bubble b1"></div>
               <div class="vial-bubble b2"></div>
             </div>
             <div class="vial-glow"></div>
             <div class="vial-highlight"></div>
             <div class="vial-label">
               <small>PEPTIDE</small>
               <strong><span>PEP</span><b>DAY</b></strong>
             </div>
           </div>
           <div class="vial-shadow"></div>
         </div>
         <div><small>FRASCO</small><h3>${esc(v.name)}</h3></div>
       </div>
       <b>${br(pct,0)}%</b>
     </div>
     <div class="vial-progress"><i style="width:${pct}%"></i></div>
     <div class="vial-stats">
       <div><small>SALDO</small><b>${br(v.remainingMg,3)} mg</b></div>
       <div><small>CONCENTRAÇÃO</small><b>${br(conc,3)} mg/mL</b></div>
       <div><small>RECONSTITUÍDO</small><b>${new Date(v.date+'T00:00:00').toLocaleDateString('pt-BR')}</b></div>
     </div>
     ${lastVialMovement(v)}
     ${forecastHtml(v)}
     <div class="vial-actions">
       <button onclick="adjustVial('${v.id}')">Ajustar saldo</button>
       <button onclick="showVialHistory('${v.id}')">Histórico</button>
       <button onclick="editVial('${v.id}')">Editar</button>
       <button onclick="deleteVial('${v.id}')">Excluir</button>
     </div>
   </div>`;
 }).join('');
}
function openVial(v=null){if(!requirePro(v?'vial:edit':'vial:create')||localDataState!=='ready')return false;editingVial=v?.id||null;$('#vialForm').classList.remove('hidden');$('#vialFormTitle').textContent=v?'Editar frasco':'Novo frasco';$('#vName').value=v?.name||'';$('#vMg').value=v?.initialMg??'';$('#vWater').value=v?.waterMl??'';$('#vDate').value=v?.date||isoToday();$('#vCost').value=v?.cost??'';return true}
async function returnToRoutineFromVial(vialId=null){
 if(!vialReturnToRoutine)return false;
 let repository=await requireLocalRepository();if(!repository)return false;
 let result=await localOperation(()=>repository.drafts.get('routine-form'));if(!result.ok)return false;let draft=result.value;
 vialReturnToRoutine=false;go('routines');if(draft)applyRoutineDraft(draft,{show:true});else $('#routineForm').classList.remove('hidden');
 if(vialId&&$('#rVial').value!==vialId)fillRoutineVials(vialId);
 calcRoutinePreview();$('#routineForm').scrollIntoView({behavior:'smooth'});return true;
}
$('#newVial').onclick=()=>{vialReturnToRoutine=false;openVial()};
$('#cancelVial').onclick=async()=>{$('#vialForm').classList.add('hidden');return returnToRoutineFromVial()};
$('#saveVial').onclick=async()=>{
 if(!requirePro(editingVial?'vial:save-edit':'vial:save-create'))return false;
 if(localDataState!=='ready')return false;
 let repository=await requireLocalRepository();if(!repository)return false;
 let name=$('#vName').value.trim(),initialMg=+$('#vMg').value,waterMl=+$('#vWater').value,date=$('#vDate').value,cost=+$('#vCost').value||0;
 if(!name||initialMg<=0||waterMl<=0||!date){alert('Confira nome, quantidade, diluente e data.');return}
 let savedVialId=editingVial;
 let savedVial;
 if(editingVial){let old=vials.find(x=>x.id===editingVial),used=Math.max(0,old.initialMg-old.remainingMg);savedVial={...old,name,initialMg,waterMl,date,cost,remainingMg:Math.max(0,initialMg-used),remoteRef:null}}
 else{savedVialId=crypto.randomUUID();savedVial={id:savedVialId,name,initialMg,waterMl,date,cost,remainingMg:initialMg,history:[]}}
 let draft=null;
 if(vialReturnToRoutine){let read=await localOperation(()=>repository.drafts.get('routine-form'));if(!read.ok)return false;draft=read.value;if(draft)draft={...draft,fields:{...draft.fields,vialId:savedVialId}}}
 let operation={operationId:crypto.randomUUID(),type:editingVial?'edit':'create'};
 let saved=draft?await localOperation(()=>repository.saveVialWithDraftAndOutbox(savedVial,draft,operation)):await localOperation(()=>repository.saveVialWithOutbox(savedVial,operation));
 if(!saved.ok)return false;
 if(editingVial)vials=vials.map(x=>x.id===editingVial?savedVial:x);else vials.push(savedVial);
 $('#vialForm').classList.add('hidden');renderVials();await returnToRoutineFromVial(savedVialId);
};
window.editVial=id=>openVial(vials.find(x=>x.id===id));
window.deleteVial=async id=>{if(!requirePro('vial:delete')||localDataState!=='ready')return false;if(routines.some(r=>r.vialId===id)){alert('Este frasco está vinculado a uma rotina. Remova ou altere o vínculo antes de excluí-lo.');return}if(confirm('Excluir este frasco e seu histórico?')){let repository=await requireLocalRepository();if(!repository)return false;if(!(await localOperation(()=>repository.deleteVialWithOutbox(id,{operationId:crypto.randomUUID()}))).ok)return false;vials=vials.filter(x=>x.id!==id);renderVials()}};
window.adjustVial=async id=>{if(!requirePro('vial:adjust-balance')||localDataState!=='ready')return false;let v=vials.find(x=>x.id===id);if(!v)return false;let raw=prompt(`Saldo atual: ${br(v.remainingMg,3)} mg\nInforme o novo saldo em mg:`,v.remainingMg);if(raw===null)return;let n=Number(String(raw).replace(',','.'));if(!Number.isFinite(n)||n<0||n>v.initialMg){alert('Informe um saldo entre 0 e a quantidade inicial do frasco.');return}let repository=await requireLocalRepository();if(!repository)return false;let before=v.remainingMg,next={...v,remainingMg:n,remoteRef:null,history:[{date:new Date().toISOString(),type:'adjust',before,after:n},...(v.history||[])]};if(!(await localOperation(()=>repository.saveVialWithOutbox(next,{operationId:crypto.randomUUID(),type:'edit'}))).ok)return false;vials=vials.map(item=>item.id===id?next:item);renderVials()};
window.showVialHistory=id=>{
 if(!requirePro('vial:view-history')||localDataState!=='ready')return false;
 let v=vials.find(x=>x.id===id),h=v.history||[];
 $('#historyCard').classList.remove('hidden');
 $('#vialHistory').innerHTML=h.length?h.map(x=>{
   let title=x.type==='dose'?'Aplicação registrada':x.type==='undo'?'Registro desfeito':'Ajuste manual';
   let doseTxt=x.doseValue!=null?`${br(x.doseValue,3)} ${x.doseUnit||'mg'}`:`${br(x.mg||0,3)} mg`;
   let detail=x.type==='dose'
     ?`${esc(x.routineName||'Rotina')} • ${doseTxt} • ${br(x.ui||0,2)} UI • -${br(x.mg||0,3)} mg`
     :x.type==='undo'
       ?`${esc(x.routineName||'Rotina')} • +${br(x.mg||0,3)} mg`
       :`${br(x.before,3)} → ${br(x.after,3)} mg`;
   return `<div class="history-row"><div><b>${title}</b><small>${new Date(x.date).toLocaleString('pt-BR')}</small></div><span>${detail}</span></div>`
 }).join(''):'<p class="muted">Ainda não há movimentações neste frasco.</p>';
 $('#historyCard').scrollIntoView({behavior:'smooth'})
};
$('#closeHistory').onclick=()=>$('#historyCard').classList.add('hidden');

$('#eraseData').onclick=async()=>{if(localDataState!=='ready')return false;if(confirm('Apagar todas as rotinas salvas neste aparelho?')){let repository=await requireLocalRepository();if(!repository)return false;if(!(await localOperation(()=>repository.clearUserData())).ok)return false;routines=[];vials=[];renderToday();renderRoutines();renderVials();alert('Dados locais apagados.')}};

let deferredPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').classList.remove('hidden')});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').classList.add('hidden')}};
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
renderLocalData();


// V2.7.1 — escala visual numerada da seringa (não altera o cálculo).
function renderPepDayNumberedSyringeScale(){
  const scale = document.getElementById('syringeNumberedScale');
  if(!scale) return;

  const syringeSelect =
    document.getElementById('syringe') ||
    document.querySelector('select[id*="syr" i], select[id*="ser" i]');

  let capacity = 100;
  if(syringeSelect){
    const txt = `${syringeSelect.value} ${syringeSelect.options?.[syringeSelect.selectedIndex]?.text || ''}`;
    const m = txt.match(/\b(30|50|100)\b/);
    if(m) capacity = Number(m[1]);
  }

  const minorStep = capacity === 100 ? 2 : 1;
  const labelStep = capacity === 100 ? 10 : 5;

  scale.innerHTML = '';

  for(let value=0; value<=capacity; value+=minorStep){
    const mark = document.createElement('span');
    const major = value % labelStep === 0;
    mark.className = major ? 'scale-mark major' : 'scale-mark minor';
    mark.style.left = `${(value/capacity)*100}%`;
    if(major){
      const label = document.createElement('b');
      label.textContent = value;
      mark.appendChild(label);
    }
    scale.appendChild(mark);
  }

  scale.dataset.capacity = capacity;
}
window.addEventListener('load', ()=>setTimeout(renderPepDayNumberedSyringeScale,100));
document.addEventListener('change', e=>{
  if(e.target && e.target.matches('select')) setTimeout(renderPepDayNumberedSyringeScale,0);
});


// ===== PepDay V2.9 — Tutorial interativo =====
const tutorialStorageKey = 'pepday_tutorial_v29_seen';
let tutorialIndex = 0;
let tutorialActive = false;

const tutorialSteps = [
  {
    screen:'home',
    target:'nav button[data-go="home"]',
    icon:'⌂',
    title:'Início',
    text:'Aqui você vê o resumo do dia e as rotinas programadas. É o ponto de partida do PepDay.'
  },
  {
    screen:'calculator',
    target:'nav button[data-go="calculator"]',
    icon:'＋',
    title:'Calculadora',
    text:'Toque em Calcular para informar os dados do frasco e visualizar mg, mcg, mL e UI. O PepDay apenas calcula os valores que você inserir.'
  },
  {
    screen:'vials',
    target:'nav button[data-go="vials"]',
    icon:'◉',
    title:'Frascos',
    text:'Cadastre seus frascos aqui. O PepDay acompanha concentração, saldo, aplicações restantes, previsão de término e reposição.'
  },
  {
    screen:'routines',
    target:'nav button[data-go="routines"]',
    icon:'◷',
    title:'Rotinas',
    text:'Em Rotinas você liga um frasco à quantidade por aplicação e à frequência definida por você. Alterações futuras não modificam o histórico anterior.'
  },
  {
    screen:'home',
    target:'#todayRoutines',
    icon:'✓',
    title:'Registrar aplicação',
    text:'Quando houver uma rotina programada para hoje, use o registro da aplicação. O saldo do frasco é atualizado e o movimento fica guardado no histórico.'
  },
  {
    screen:'profile',
    target:'#replayTutorial',
    icon:'?',
    title:'Ajuda sempre disponível',
    text:'Terminou! No Perfil, toque em “Ver tutorial novamente” sempre que quiser rever este passo a passo.'
  }
];

function tutorialEl(id){ return document.getElementById(id); }

function tutorialPosition(target){
  const spot = tutorialEl('tutorialSpotlight');
  const card = tutorialEl('tutorialCard');
  const arrow = tutorialEl('tutorialArrow');
  if(!target || !spot || !card) return;

  const r = target.getBoundingClientRect();
  const pad = 7;
  spot.style.left = Math.max(6, r.left-pad) + 'px';
  spot.style.top = Math.max(6, r.top-pad) + 'px';
  spot.style.width = Math.min(window.innerWidth-12, r.width+pad*2) + 'px';
  spot.style.height = (r.height+pad*2) + 'px';

  // Place card where it does not cover the highlighted area.
  const cardH = Math.min(card.offsetHeight || 260, window.innerHeight * .62);
  const roomBelow = window.innerHeight - r.bottom;
  const below = roomBelow > cardH + 42;

  card.classList.toggle('tutorial-card-top', !below);
  card.classList.toggle('tutorial-card-bottom', below);

  if(below){
    card.style.top = Math.min(window.innerHeight-cardH-18, r.bottom+28) + 'px';
    arrow.textContent = '↑';
    arrow.style.top = (r.bottom+3) + 'px';
  }else{
    card.style.top = Math.max(18, r.top-cardH-28) + 'px';
    arrow.textContent = '↓';
    arrow.style.top = Math.max(8, r.top-28) + 'px';
  }

  arrow.style.left = Math.max(14, Math.min(window.innerWidth-34, r.left+r.width/2-10)) + 'px';
}

function renderTutorialStep(){
  if(!tutorialActive) return;
  const step = tutorialSteps[tutorialIndex];
  const entered=go(step.screen);

  setTimeout(()=>{
    tutorialEl('tutorialStep').textContent = `${tutorialIndex+1} de ${tutorialSteps.length}`;
    tutorialEl('tutorialIcon').textContent = step.icon;
    tutorialEl('tutorialTitle').textContent = step.title;
    tutorialEl('tutorialText').textContent = step.text;
    tutorialEl('tutorialBack').disabled = tutorialIndex===0;
    tutorialEl('tutorialNext').textContent = tutorialIndex===tutorialSteps.length-1 ? 'Concluir' : 'Próximo';

    const target = document.querySelector(entered?step.target:`nav [data-go="${step.screen}"]`);
    if(target){
      target.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});
      setTimeout(()=>tutorialPosition(target),220);
    }
  },80);
}

function startTutorial(force=false){
  if(!force && localStorage.getItem(tutorialStorageKey)==='1') return;
  tutorialActive = true;
  tutorialIndex = 0;
  tutorialEl('tutorialOverlay')?.classList.remove('hidden');
  document.body.classList.add('tutorial-open');
  renderTutorialStep();
}

function finishTutorial(){
  tutorialActive = false;
  localStorage.setItem(tutorialStorageKey,'1');
  tutorialEl('tutorialOverlay')?.classList.add('hidden');
  document.body.classList.remove('tutorial-open');
  go('home');
}

tutorialEl('tutorialNext')?.addEventListener('click',()=>{
  if(tutorialIndex < tutorialSteps.length-1){
    tutorialIndex++;
    renderTutorialStep();
  } else {
    finishTutorial();
  }
});

tutorialEl('tutorialBack')?.addEventListener('click',()=>{
  if(tutorialIndex>0){
    tutorialIndex--;
    renderTutorialStep();
  }
});

tutorialEl('tutorialSkip')?.addEventListener('click',finishTutorial);
tutorialEl('replayTutorial')?.addEventListener('click',()=>startTutorial(true));

window.addEventListener('resize',()=>{
  if(tutorialActive){
    const step=tutorialSteps[tutorialIndex];
    tutorialPosition(document.querySelector(step.target));
  }
});

window.addEventListener('load',()=>{
  setTimeout(()=>startTutorial(false),450);
});
