
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const key='pepday_v1_routines';
let routines=JSON.parse(localStorage.getItem(key)||'[]');
let lastCalc=null, editing=null;

function isoToday(){let d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function br(n,max=4){return Number(n).toLocaleString('pt-BR',{maximumFractionDigits:max})}
function go(id){$$('.screen').forEach(x=>x.classList.toggle('active',x.id===id)); $$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.go===id)); window.scrollTo({top:0,behavior:'smooth'}); if(id==='home') renderToday(); if(id==='routines') renderRoutines()}
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
  box.innerHTML=list.map(r=>{let done=(r.done||[]).includes(isoToday()); return `<div class="routine ${done?'done':''}"><div><h4>${esc(r.name)}</h4><p>${r.time?esc(r.time)+' • ':''}${freqLabel(r)}</p></div><div><div class="value">${br(r.ui,2)} UI</div><button onclick="toggleDone('${r.id}')">${done?'Desfazer':'Registrar'}</button></div></div>`}).join('');
}
function toggleDone(id){let r=routines.find(x=>x.id===id); r.done=r.done||[]; let t=isoToday(); r.done=r.done.includes(t)?r.done.filter(x=>x!==t):[...r.done,t]; save();renderToday()}
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

function openRoutine(calc=null,r=null){
 $('#routineForm').classList.remove('hidden'); editing=r?r.id:null; $('#routineFormTitle').textContent=r?'Editar rotina':'Nova rotina';
 $('#rName').value=r?.name||calc?.name||''; $('#rUi').value=r?.ui??(calc?Number(calc.ui.toFixed(4)):''); $('#rMl').value=r?.ml??(calc?Number(calc.ml.toFixed(6)):'');
 $('#frequency').value=r?.frequency||'daily'; $('#startDate').value=r?.start||isoToday(); $('#rTime').value=r?.time||'';
 $$('#weekdaysBox input').forEach(c=>c.checked=(r?.weekdays||[]).includes(+c.value)); toggleWeekdays();
}
$('#newRoutine').onclick=()=>openRoutine(); $('#cancelRoutine').onclick=()=>$('#routineForm').classList.add('hidden');
$('#frequency').onchange=toggleWeekdays;
function toggleWeekdays(){$('#weekdaysBox').classList.toggle('hidden',$('#frequency').value!=='weekdays')}
$('#saveRoutine').onclick=()=>{
 let name=$('#rName').value.trim(), ui=+$('#rUi').value, ml=+$('#rMl').value, frequency=$('#frequency').value, start=$('#startDate').value;
 if(!name||!start||ui<0||ml<0){alert('Confira nome, data e valores da rotina.');return}
 let weekdays=$$('#weekdaysBox input:checked').map(x=>+x.value);
 if(frequency==='weekdays'&&!weekdays.length){alert('Selecione ao menos um dia da semana.');return}
 let obj={id:editing||crypto.randomUUID(),name,ui,ml,frequency,start,time:$('#rTime').value,weekdays,done:editing?(routines.find(x=>x.id===editing)?.done||[]):[]};
 if(editing)routines=routines.map(x=>x.id===editing?obj:x); else routines.push(obj);
 save();$('#routineForm').classList.add('hidden');renderRoutines();
};
function renderRoutines(){
 let box=$('#routineList'); if(!routines.length){box.innerHTML='<div class="card empty"><p>Você ainda não salvou nenhuma rotina.</p></div>';return}
 box.innerHTML=routines.map(r=>`<div class="routine"><div><h4>${esc(r.name)}</h4><p>${freqLabel(r)} • início ${new Date(r.start+'T00:00:00').toLocaleDateString('pt-BR')}</p></div><div><div class="value">${br(r.ui,2)} UI</div><button onclick="editR('${r.id}')">Editar</button> <button onclick="delR('${r.id}')">Excluir</button></div></div>`).join('');
}
window.editR=id=>openRoutine(null,routines.find(x=>x.id===id));
window.delR=id=>{if(confirm('Excluir esta rotina?')){routines=routines.filter(x=>x.id!==id);save();renderRoutines()}};
function save(){localStorage.setItem(key,JSON.stringify(routines))}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
$('#eraseData').onclick=()=>{if(confirm('Apagar todas as rotinas salvas neste aparelho?')){localStorage.removeItem(key);routines=[];renderToday();alert('Dados locais apagados.')}};

let deferredPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').classList.remove('hidden')});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').classList.add('hidden')}};
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
renderToday();
