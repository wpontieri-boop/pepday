import {parsePepDayReference} from '../mercado-pago-webhook/webhook-core.mjs';
export const testEnvironment=(url,live)=>url==='https://fsbqpyyprtymwrmzsacp.supabase.co'&&live==='false';
export function cents(value){
 if(value===null||value===undefined)return null;
 const text=String(value);if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(text))return null;
 const [whole,fraction='']=text.split('.');const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 return result<=BigInt(Number.MAX_SAFE_INTEGER)?Number(result):null;
}
export function canonicalPayment(payment,invoice,contract,subscriptionId,firstPaymentId,historyComplete,disputed=false){
 const ref=parsePepDayReference(contract.external_reference);
 if(ref?.subscriptionId!==subscriptionId||String(invoice.preapproval_id)!==String(contract.id)||String(invoice.payment?.id)!==String(payment.id)||payment.live_mode!==false)throw Error('CANONICAL_MAPPING_MISMATCH');
 if(payment.external_reference&&parsePepDayReference(payment.external_reference)?.subscriptionId!==subscriptionId)throw Error('CANONICAL_MAPPING_MISMATCH');
 const amount=cents(payment.transaction_amount),refund=cents(payment.transaction_amount_refunded);
 const paid=new Date(payment.date_approved),updated=new Date(payment.date_last_updated);
 if(!payment.date_approved||!Number.isFinite(paid.getTime())||!Number.isFinite(updated.getTime()))throw Error('CANONICAL_TIME_REQUIRED');
 let state=disputed||payment.status==='in_mediation'?'disputed':payment.status==='charged_back'?'charged_back':payment.status==='refunded'?'refunded':payment.status==='approved'?'approved':'review';
 if(amount===null||refund===null||refund>amount)state='review';
 return {id:String(payment.id),invoice_id:String(invoice.id),plan:/:recovery:/.test(contract.external_reference)?'recovery':ref.plan,
  currency:payment.currency_id||null,gross_cents:amount,refunded_cents:refund??0,paid_at:paid.toISOString(),updated_at:updated.toISOString(),
  state,live_mode:false,first_payment_id:firstPaymentId,history_complete:historyComplete};
}
export async function allPages(get,path){
 const rows=[],ids=new Set();let total=null;
 for(let offset=0;offset<10000;){
  const page=await get(path+(path.includes('?')?'&':'?')+'limit=100&offset='+offset);
  if(!Array.isArray(page.results)||!Number.isSafeInteger(page.paging?.total)||page.paging.total<0)throw Error('CANONICAL_HISTORY_INCOMPLETE');
  if(total!==null&&total!==page.paging.total)throw Error('CANONICAL_HISTORY_CHANGED');total=page.paging.total;
  for(const item of page.results){if(item.id==null||ids.has(String(item.id)))throw Error('CANONICAL_HISTORY_INCOMPLETE');ids.add(String(item.id))}
  rows.push(...page.results);if(rows.length===total)return rows;
  if(rows.length>total||!page.results.length||page.results.length>100)throw Error('CANONICAL_HISTORY_INCOMPLETE');
  if(page.paging.offset!==offset||page.paging.limit!==page.results.length)throw Error('CANONICAL_HISTORY_INCOMPLETE');
  offset+=page.results.length;
 }throw Error('CANONICAL_HISTORY_LIMIT');
}
export async function reconcileSource(source,{get,ingest,release}){
 const current=await get('/preapproval/'+encodeURIComponent(source.provider_id));
 if(parsePepDayReference(current.external_reference)?.subscriptionId!==source.subscription_id||current.payer_id==null)throw Error('CANONICAL_MAPPING_MISMATCH');
 const contracts=(await allPages(get,'/preapproval/search?payer_id='+encodeURIComponent(current.payer_id)))
  .filter(c=>parsePepDayReference(c.external_reference)?.subscriptionId===source.subscription_id);
 if(!contracts.some(c=>String(c.id)===String(current.id)))throw Error('CANONICAL_HISTORY_INCOMPLETE');
 const payments=[],invoiceIds=new Set();
 for(const found of contracts){
  const contract=String(found.id)===String(current.id)?current:await get('/preapproval/'+encodeURIComponent(found.id));
  if(parsePepDayReference(contract.external_reference)?.subscriptionId!==source.subscription_id)throw Error('CANONICAL_MAPPING_MISMATCH');
  for(const invoice of await allPages(get,'/authorized_payments/search?preapproval_id='+encodeURIComponent(contract.id))){
   invoiceIds.add(String(invoice.id));
   if(!invoice.payment?.id)continue;
   const payment=await get('/v1/payments/'+encodeURIComponent(invoice.payment.id));
   if(!payment.date_approved)continue;
   if(!payment.collector_id)throw Error('CANONICAL_SELLER_REQUIRED');
   const disputes=await allPages(path=>get(path,{'X-Caller-Id':String(payment.collector_id)}),'/v1/chargebacks/search?payment_id='+encodeURIComponent(payment.id));
   // Documentation/coverage flags do not prove that a chargeback was reversed.
   const disputed=disputes.length>0;
   payments.push({payment,invoice,contract,disputed});
  }
 }
 // A previous billing invoice outside provider pagination is missing history,
 // never evidence that the account has no earlier payment.
 const complete=(source.historical_invoices||[]).every(id=>invoiceIds.has(String(id)));
 payments.sort((a,b)=>new Date(a.payment.date_approved)-new Date(b.payment.date_approved)||String(a.payment.id).localeCompare(String(b.payment.id)));
 const first=payments[0]?.payment.id;
 for(const p of payments)await ingest(source.subscription_id,canonicalPayment(p.payment,p.invoice,p.contract,source.subscription_id,String(first),complete,p.disputed));
 if(complete)await release(source.partner_id);
 return {payments:payments.length,history_complete:complete};
}
