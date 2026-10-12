import {config} from '/config.js';
import {LEGAL_REVIEW,partnerLegalDocuments} from '/src/partner-legal-bundle.mjs';
const $=id=>document.getElementById(id);
const allowed=config.environment==='test'&&config.projectRef==='fsbqpyyprtymwrmzsacp'&&location.origin==='https://homologacao.pepday.com.br';
const hash=async t=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t))),b=>b.toString(16).padStart(2,'0')).join('');
let generation=0;
async function render(){
 const attempt=++generation,d=partnerLegalDocuments.find(d=>d.id===$('document').value);$('content').textContent='';$('integrity').textContent='';
 if(!allowed||!d)return;
 const digest=await hash(d.body);if(attempt!==generation)return;
 if(digest!==d.sha256){$('title').textContent='';$('version').textContent='';$('status').textContent='Integridade não confirmada. Documento bloqueado.';return}
 $('status').textContent='Preparação TEST · aprovação comercial interna registrada.';
 $('title').textContent=d.title;$('version').textContent='Versão '+d.version;$('content').textContent=d.body;$('integrity').textContent='SHA256 conferido: '+d.sha256;$('accept').disabled=true;
}
if(allowed&&LEGAL_REVIEW.ownerCommercialApproved&&LEGAL_REVIEW.realAcceptanceEnabled===false){
 $('status').textContent='Preparação TEST · aprovação comercial interna registrada.';$('workspace').hidden=false;
 for(const d of partnerLegalDocuments)$('document').append(new Option(d.title,d.id));
 $('document').addEventListener('change',()=>render());render();
}else $('status').textContent='Consulta disponível somente em homologação.';
