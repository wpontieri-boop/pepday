
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const key='pepday_v1_routines';
let routines=JSON.parse(localStorage.getItem(key)||'[]');
const vialKey='pepday_v2_vials';
let vials=JSON.parse(localStorage.getItem(vialKey)||'[]');
let lastCalc=null, editing=null, editingVial=null, vialReturnToRoutine=false;

function isoToday(){let d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function br(n,max=4){return Number(n).toLocaleString('pt-BR',{maximumFractionDigits:max})}
function go(id){$$('.screen').forEach(x=>x.classList.toggle('active',x.id===id)); $$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.go===id)); window.scrollTo({top:0,behavior:'smooth'}); if(id==='home') renderToday(); if(id==='routines') renderRoutines(); if(id==='vials') renderVials()}
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
  let box=$('#todayRoutines'), list=routines.filter(r=>activeOn(r,d));
  if(!list.length){box.innerHTML='<div class="empty"><p>Nenhuma rotina programada para hoje.</p></div>';return}
  box.innerHTML=list.map(r=>{let done=(r.done||[]).includes(isoToday()),v=vials.find(x=>x.id===r.vialId); return `<div class="routine ${done?'done':''}"><div><h4>${esc(r.name)}</h4><p>${r.time?esc(r.time)+' • ':''}${br(r.doseValue,3)} ${r.doseUnit} • ${freqLabel(r)}${v?` • ${esc(v.name)}`:''}</p></div><div><div class="value">${br(r.ui,2)} UI</div><button onclick="toggleDone('${r.id}')">${done?'Desfazer':'Registrar'}</button></div></div>`}).join('');
}
function toggleDone(id){
 let r=routines.find(x=>x.id===id); if(!r)return; r.done=r.done||[]; let day=isoToday(), done=r.done.includes(day), v=vials.find(x=>x.id===r.vialId);
 if(!done){
   if(v){
     if(v.remainingMg+1e-9<r.doseMg){alert(`Saldo insuficiente em ${v.name}. Restam ${br(v.remainingMg,3)} mg.`);return}
     let before=v.remainingMg; v.remainingMg=Math.max(0,v.remainingMg-r.doseMg); v.history=v.history||[];
     v.history.unshift({date:new Date().toISOString(),type:'dose',routineId:r.id,routineName:r.name,day,mg:r.doseMg,ui:r.ui,ml:r.ml,doseValue:r.doseValue,doseUnit:r.doseUnit,vialId:r.vialId,before,after:v.remainingMg});
     saveVials();
   }
   r.done=[...r.done,day];
 }else{
   r.done=r.done.filter(x=>x!==day);
   if(v){
     v.history=v.history||[];
     let i=v.history.findIndex(h=>h.type==='dose'&&h.routineId===r.id&&h.day===day);
     if(i>=0){let h=v.history[i],before=v.remainingMg;v.remainingMg=Math.min(v.initialMg,v.remainingMg+h.mg);v.history.splice(i,1);v.history.unshift({date:new Date().toISOString(),type:'undo',routineId:r.id,routineName:r.name,day,mg:h.mg,ui:r.ui,before,after:v.remainingMg});saveVials()}
   }
 }
 save();renderToday();renderVials();
}
window.toggleDone=toggleDone;

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
$('#newRoutine').onclick=()=>openRoutine(); $('#cancelRoutine').onclick=()=>$('#routineForm').classList.add('hidden');
$('#routineAddVial').onclick=()=>{
 vialReturnToRoutine=true;
 go('vials');
 openVial();
 $('#vialForm').scrollIntoView({behavior:'smooth'});
};
$('#frequency').onchange=toggleWeekdays;
function toggleWeekdays(){$('#weekdaysBox').classList.toggle('hidden',$('#frequency').value!=='weekdays')}
$('#saveRoutine').onclick=()=>{
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
 if(editing)routines=routines.map(x=>x.id===editing?obj:x); else routines.push(obj);
 save();$('#routineForm').classList.add('hidden');renderRoutines();renderToday();renderVials();
};
function renderRoutines(){
 let box=$('#routineList'); if(!routines.length){box.innerHTML='<div class="card empty"><p>Você ainda não salvou nenhuma rotina.</p></div>';return}
 box.innerHTML=routines.map(r=>{let v=vials.find(x=>x.id===r.vialId);return `<div class="routine"><div><h4>${esc(r.name)}</h4><p>${br(r.doseValue,3)} ${r.doseUnit} por aplicação • ${freqLabel(r)}${v?` • ${esc(v.name)}`:''}</p></div><div><div class="value">${br(r.ui,2)} UI</div><button onclick="editR('${r.id}')">Editar</button> <button onclick="delR('${r.id}')">Excluir</button></div></div>`}).join('');
}
window.editR=id=>openRoutine(null,routines.find(x=>x.id===id));
window.delR=id=>{if(confirm('Excluir esta rotina?')){routines=routines.filter(x=>x.id!==id);save();renderRoutines()}};
function save(){localStorage.setItem(key,JSON.stringify(routines))}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function saveVials(){localStorage.setItem(vialKey,JSON.stringify(vials))}
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
function openVial(v=null){editingVial=v?.id||null;$('#vialForm').classList.remove('hidden');$('#vialFormTitle').textContent=v?'Editar frasco':'Novo frasco';$('#vName').value=v?.name||'';$('#vMg').value=v?.initialMg??'';$('#vWater').value=v?.waterMl??'';$('#vDate').value=v?.date||isoToday();$('#vCost').value=v?.cost??''}
function returnToRoutineFromVial(vialId=null){
 if(!vialReturnToRoutine)return false;
 vialReturnToRoutine=false;go('routines');$('#routineForm').classList.remove('hidden');
 if(vialId)fillRoutineVials(vialId);
 calcRoutinePreview();$('#routineForm').scrollIntoView({behavior:'smooth'});return true;
}
$('#newVial').onclick=()=>{vialReturnToRoutine=false;openVial()};
$('#cancelVial').onclick=()=>{$('#vialForm').classList.add('hidden');returnToRoutineFromVial()};
$('#saveVial').onclick=()=>{
 let name=$('#vName').value.trim(),initialMg=+$('#vMg').value,waterMl=+$('#vWater').value,date=$('#vDate').value,cost=+$('#vCost').value||0;
 if(!name||initialMg<=0||waterMl<=0||!date){alert('Confira nome, quantidade, diluente e data.');return}
 let savedVialId=editingVial;
 if(editingVial){let old=vials.find(x=>x.id===editingVial),used=Math.max(0,old.initialMg-old.remainingMg);vials=vials.map(x=>x.id===editingVial?{...old,name,initialMg,waterMl,date,cost,remainingMg:Math.max(0,initialMg-used)}:x)}
 else{savedVialId=crypto.randomUUID();vials.push({id:savedVialId,name,initialMg,waterMl,date,cost,remainingMg:initialMg,history:[]})}
 saveVials();$('#vialForm').classList.add('hidden');renderVials();returnToRoutineFromVial(savedVialId);
};
window.editVial=id=>openVial(vials.find(x=>x.id===id));
window.deleteVial=id=>{if(routines.some(r=>r.vialId===id)){alert('Este frasco está vinculado a uma rotina. Remova ou altere o vínculo antes de excluí-lo.');return}if(confirm('Excluir este frasco e seu histórico?')){vials=vials.filter(x=>x.id!==id);saveVials();renderVials()}};
window.adjustVial=id=>{let v=vials.find(x=>x.id===id),raw=prompt(`Saldo atual: ${br(v.remainingMg,3)} mg\nInforme o novo saldo em mg:`,v.remainingMg);if(raw===null)return;let n=Number(String(raw).replace(',','.'));if(!Number.isFinite(n)||n<0||n>v.initialMg){alert('Informe um saldo entre 0 e a quantidade inicial do frasco.');return}let before=v.remainingMg;v.remainingMg=n;v.history=v.history||[];v.history.unshift({date:new Date().toISOString(),type:'adjust',before,after:n});saveVials();renderVials()};
window.showVialHistory=id=>{
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

$('#eraseData').onclick=()=>{if(confirm('Apagar todas as rotinas salvas neste aparelho?')){localStorage.removeItem(key);localStorage.removeItem(vialKey);routines=[];vials=[];renderToday();alert('Dados locais apagados.')}};

let deferredPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').classList.remove('hidden')});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').classList.add('hidden')}};
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
renderToday();


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
  go(step.screen);

  setTimeout(()=>{
    tutorialEl('tutorialStep').textContent = `${tutorialIndex+1} de ${tutorialSteps.length}`;
    tutorialEl('tutorialIcon').textContent = step.icon;
    tutorialEl('tutorialTitle').textContent = step.title;
    tutorialEl('tutorialText').textContent = step.text;
    tutorialEl('tutorialBack').disabled = tutorialIndex===0;
    tutorialEl('tutorialNext').textContent = tutorialIndex===tutorialSteps.length-1 ? 'Concluir' : 'Próximo';

    const target = document.querySelector(step.target);
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
