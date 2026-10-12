// Read-only monitor; same OWNER/AAL2 and TEST guards enforced in the database.
export function installWhatsAppMonitor({rpc,run,canRead}){
 const button=document.getElementById('waRefresh'),status=document.getElementById('waStatus'),rows=document.getElementById('waRows');
 let generation=0;
 button.addEventListener('click',()=>run(async()=>{
 if(!canRead())return;const attempt=generation;button.disabled=true;rows.replaceChildren();
 try{
 const data=await rpc('admin_partner_whatsapp_test',{p_request:{action:'list'}});
 if(!canRead()||attempt!==generation)return;
 if(data.real_send!==false||data.central_enabled!==false)throw Error('DISABLED_REQUIRED');
 status.textContent='Modo '+data.mode+' · envio real desativado · Central IA desativada.';
 for(const o of data.outbox||[]){
 const p=document.createElement('p');p.textContent=o.kind+' · '+o.state+' · '+new Date(o.updated_at).toLocaleString('pt-BR');rows.append(p);
 }
 if(!rows.childNodes.length)rows.textContent='Nenhuma mensagem registrada na infraestrutura.';
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Histórico técnico ('+(data.events||[]).length+')';details.append(summary);
 for(const e of data.events||[]){const p=document.createElement('p');p.textContent=e.kind+' · '+new Date(e.created_at).toLocaleString('pt-BR');details.append(p)}rows.append(details);
 }catch{if(canRead()&&attempt===generation)status.textContent='Consulta indisponível. Confira a sessão OWNER TEST; nenhum envio foi realizado.'}
 finally{button.disabled=false}
 }));
 return ()=>{generation++;status.textContent='';rows.replaceChildren()};
}
