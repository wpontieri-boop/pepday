// Offline preflight only: never stores a record, uploads bytes, signs a contract or enables real collection.
import {validDocument,validPix,normalizeDocument} from '../site/admin/parceiros/validation.mjs';
export const REAL_PARTNER_GATES=Object.freeze({realCollection:false,contractAcceptance:false,realOtp:false,realSend:false});
export function inspectPartnerDraft(p){
 const errors=[];if(!p||typeof p!=='object'||Array.isArray(p))return {valid:false,errors:['INVALID_OBJECT'],...REAL_PARTNER_GATES};
 for(const k of Object.keys(p))if(!['kind','legal_name','document','email','pix_type','pix_key','representative_name'].includes(k))errors.push('UNKNOWN_FIELD');
 const doc=normalizeDocument(p.document);
 if(!['CPF','MEI','CNPJ'].includes(p.kind))errors.push('INVALID_KIND');
 if(!validDocument(doc)||(p.kind==='CPF'&&!/^\d{11}$/.test(doc))||(['MEI','CNPJ'].includes(p.kind)&&!/^[A-Z0-9]{12}\d{2}$/.test(doc)))errors.push('INVALID_DOCUMENT');
 if(typeof p.legal_name!=='string'||p.legal_name.trim().length<2||p.legal_name.length>160||/[\u0000-\u001f]/.test(p.legal_name))errors.push('INVALID_NAME');
 if(typeof p.email!=='string'||p.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))errors.push('INVALID_EMAIL');
 if(!validPix(p.pix_type,p.pix_key))errors.push('INVALID_PIX');
 if(p.representative_name!==undefined&&(typeof p.representative_name!=='string'||p.representative_name.trim().length<2||p.representative_name.length>160))errors.push('INVALID_REPRESENTATIVE');
 // Format/checksum is not identity, ownership, legal representation or fiscal approval.
 return {valid:errors.length===0,errors,identityVerified:false,representationVerified:false,...REAL_PARTNER_GATES};
}
export function inspectDocumentCandidate({size,mime,bytes}={}){
 const errors=[];if(!Number.isInteger(size)||size<1||size>5*1024*1024)errors.push('INVALID_SIZE');
 if(!(bytes instanceof Uint8Array)||bytes.length!==size)errors.push('INVALID_BYTES');
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array();
 const matches=mime==='application/pdf'?new TextDecoder().decode(b.slice(0,5))==='%PDF-':
 mime==='image/png'?[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v):
 mime==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:false;
 if(!matches)errors.push('MIME_SIGNATURE_MISMATCH');
 // Magic bytes are only preflight; quarantine, malware scanning and ACL proof are mandatory gates.
 return {valid:errors.length===0,errors,uploadEnabled:false,quarantineRequired:true,malwareScanRequired:true};
}
export function inspectContractVersion({version,sha256,legalApproved=false}={}){
 return {valid:typeof version==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(version)&&typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256),
 legalApproved:legalApproved===true,acceptanceEnabled:false};
}
