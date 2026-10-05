import test from 'node:test';
import assert from 'node:assert/strict';
import {isRecoveryTest,introductoryRecurring,normalRecurringUpdate,resetConfirmed,recoveryMessage} from '../supabase/functions/recovery-worker/recovery-core.mjs';
import {checkoutRecurring} from '../supabase/functions/mercado-pago-checkout/checkout-core.mjs';
import {parsePepDayReference} from '../supabase/functions/mercado-pago-webhook/webhook-core.mjs';
test('recovery only runs on the exact TEST project and sandbox mode',()=>{
  assert.equal(isRecoveryTest('https://fsbqpyyprtymwrmzsacp.supabase.co','false'),true);
  for(const [url,mode] of [['https://oslefjmwfnddxlotalxu.supabase.co','false'],['https://fsbqpyyprtymwrmzsacp.supabase.co','true'],['https://fsbqpyyprtymwrmzsacp.supabase.co.evil.test','false']])assert.equal(isRecoveryTest(url,mode),false);
});
test('discounted contract expires before a second monthly charge and rejects expired windows',()=>{
  const now=Date.parse('2026-10-05T18:00:00Z');
  assert.equal(introductoryRecurring(new Date(now).toISOString(),now),null);
  assert.equal(introductoryRecurring(new Date(now+73*3600000).toISOString(),now),null);
  const config=introductoryRecurring(new Date(now+72*3600000).toISOString(),now);
  assert.equal(config.transaction_amount,9.90);assert.equal(config.frequency,1);assert.equal(config.end_date,'2026-10-08T18:00:00.000Z');
});
test('price after first cycle is 14.90; normal monthly and annual prices remain unchanged',()=>{
  assert.equal(normalRecurringUpdate().auto_recurring.transaction_amount,14.90);
  assert.equal(checkoutRecurring('monthly').transaction_amount,14.90);
  assert.equal(checkoutRecurring('annual').transaction_amount,99.90);
  assert.equal(resetConfirmed(normalRecurringUpdate()),true);
  assert.equal(resetConfirmed({auto_recurring:{transaction_amount:9.90,currency_id:'BRL',end_date:null}}),false);
  assert.equal(resetConfirmed({auto_recurring:{transaction_amount:14.90,currency_id:'BRL',end_date:'2026-11-01'}}),false);
  assert.equal(normalRecurringUpdate('2026-12-31T12:00:00Z').auto_recurring.end_date,'2027-03-01T12:00:00.000Z');
});
test('recovery references map to the same canonical subscription without changing ordinary references',()=>{
  const id='10000000-0000-4000-8000-000000000001';
  assert.deepEqual(parsePepDayReference(`pepday:${id}:monthly:recovery:${id}`),{subscriptionId:id,plan:'monthly'});
  assert.equal(parsePepDayReference(`pepday:${id}:annual:recovery:${id}`),null);
});
test('offer communications include first month, normal price, deadline and courtesy restriction',()=>{
  for(const stage of ['offer','last']){const message=recoveryMessage(stage,'card');
    for(const part of ['9,90','14,90','offer_expires_at','único','cortesia','99,90'])assert.ok(message.text.includes(part),part);}
  assert.match(recoveryMessage('warning','card').text,/30 dias/);
  assert.match(recoveryMessage('warning','trial').text,/7 dias/);
});
