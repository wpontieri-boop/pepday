import {isRecoveryTest,normalRecurringUpdate,resetConfirmed} from '../recovery-worker/recovery-core.mjs';
import {env,rpc,provider} from '../recovery-worker/backend.mjs';
import {paidPeriod,parsePepDayReference,canonicalEventDate} from './webhook-core.mjs';
export async function reconcileRecoveryInvoice(subscriptionId,preapproval,invoice){
  const reference=parsePepDayReference(preapproval.external_reference);
  if(!invoice||invoice.payment?.status!=='approved'||reference?.subscriptionId!==subscriptionId||reference.plan!=='monthly')return;
  const period=paidPeriod(invoice,preapproval),eventAt=canonicalEventDate(null,invoice);
  if(!period||!eventAt)throw new Error('RECOVERY_CANONICAL_PERIOD_REQUIRED');
  return await rpc('apply_billing_event',{
    p_provider_event_id:'recovery-reconcile:'+String(invoice.id),p_event_type:'subscription_authorized_payment',
    p_action:'recovery.reconciled',p_provider_resource_id:String(invoice.id),p_subscription_id:subscriptionId,
    p_effect:'payment_approved',p_provider_event_at:eventAt,p_provider_subscription_id:String(preapproval.id),
    p_provider_plan_id:null,p_plan:'monthly',p_period_start:period.start,p_period_end:period.end
  });
}
export async function applyRecoveryBilling(preapproval,invoice){
  if(!isRecoveryTest(env('SUPABASE_URL'),env('MERCADO_PAGO_LIVE_MODE')))return;
  if(!/:monthly:recovery:[0-9a-f-]{36}$/i.test(preapproval.external_reference||''))return;
  const id=String(preapproval.id);
  if(!invoice){if(preapproval.status==='authorized')await rpc('update_recovery_provider_state',{p_provider_id:id,p_outcome:'authorized'});return;}
  if(invoice.payment?.status!=='approved')return;
  const result=await rpc('record_recovery_payment',{p_provider_id:id,p_invoice_id:String(invoice.id),
    p_amount:Number(invoice.transaction_amount??invoice.payment?.transaction_amount),p_paid_at:invoice.debit_date||invoice.date_created});
  if(result.outcome==='invalid')throw new Error('RECOVERY_PAYMENT_REQUIRES_REVIEW');
  if(result.outcome==='normal')return;
  if(['cancelled','canceled','paused'].includes(preapproval.status))return;
  if(result.reset_needed||result.outcome==='duplicate'){
    const update=normalRecurringUpdate(invoice.debit_date||invoice.date_created);
    const updated=resetConfirmed(preapproval,update.auto_recurring.end_date)?preapproval:await provider('/preapproval/'+encodeURIComponent(id),'PUT',update);
    if(!resetConfirmed(updated,update.auto_recurring.end_date))throw new Error('RECOVERY_PRICE_RESET_UNCONFIRMED');
    await rpc('update_recovery_provider_state',{p_provider_id:id,p_outcome:'reset'});
    return updated;
  }
}
