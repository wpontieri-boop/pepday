// Server-side policy preparation; trusted policy/context must come from backend, never request fields.
const purposes=new Set(['identity','representation','payment','fiscal','contract','security','channel']);
export const PARTNER_DATA_POLICY=Object.freeze({
  identity:{fields:['legal_name','document'],basis:'contract_preparation'},
  representation:{fields:['representative_name','representation_evidence'],basis:'contract_preparation'},
  payment:{fields:['pix_type','pix_key','payee_name'],basis:'contract_execution'},
  fiscal:{fields:['fiscal_document','period'],basis:'legal_obligation_after_accountant_definition'},
  contract:{fields:['version','sha256','accepted_at'],basis:'contract_execution'},
  security:{fields:['event','reference','occurred_at'],basis:'security_and_regular_exercise_of_rights'},
  channel:{fields:['verified_contact','consent_version','consent_at','opt_out_at'],basis:'separate_channel_consent'}
});
export function minimizePartnerFields(purpose,input){
  const policy=PARTNER_DATA_POLICY[purpose];if(!policy||!input||typeof input!=='object'||Array.isArray(input))throw Error('PRIVACY_PURPOSE_DENIED');
  const allowed=new Set(policy.fields);if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('PRIVACY_EXCESS_DATA_DENIED');
  // Never return PII in diagnostics or audit. This function only validates field names.
  return {allowed:true,purpose,fields:Object.keys(input).sort(),realCollection:false};
}
export function retentionDecision({purpose,now=Date.now(),expiresAt,legalHold=false,policyVersion,approvedAt,approvedBy}={}){
  if(!purposes.has(purpose)||!Number.isFinite(now))return {action:'block',reason:'INVALID_PURPOSE'};
  if(legalHold===true)return {action:'preserve_restricted',reason:'LEGAL_HOLD'};
  if(!Number.isFinite(expiresAt)||!Number.isFinite(approvedAt)||approvedAt>now||!/^QA-[A-Za-z0-9_-]{1,80}$/.test(approvedBy||'')||!/^qa-policy-[a-z0-9-]{1,60}$/.test(policyVersion||''))return {action:'block',reason:'POLICY_UNDEFINED'};
  // These are QA policy decisions, not fiscal deadlines or live erasure authorizations.
  return {action:expiresAt<=now?'eligible_synthetic_erasure':'preserve_restricted',reason:'EXPLICIT_QA_POLICY',realErasure:false};
}
export function rightsDecision({request,requester,owner,verified=false,channelOptOut=false}={}){
  if(!['access','correction','erasure','channel_opt_out'].includes(request)||verified!==true||!/^QA-[A-Za-z0-9_-]{1,80}$/.test(requester||'')||requester!==owner)return {allowed:false,reason:'IDENTITY_OR_SCOPE_DENIED'};
  return {allowed:true,request,contractAccessPreserved:true,commissionPreserved:true,eraseDocuments:false,stopChannel:request==='channel_opt_out'||channelOptOut===true,realAction:false};
}
export function safeIncidentEvent(input){
  if(!input||Object.keys(input).some(k=>!['kind','reference','occurredAt'].includes(k))||!['suspected','contained','assessed','notification_review','closed'].includes(input.kind)||!/^QA-[A-Za-z0-9_-]{1,80}$/.test(input.reference||'')||!Number.isFinite(input.occurredAt))throw Error('INCIDENT_EVENT_DENIED');
  return {...input};
}
