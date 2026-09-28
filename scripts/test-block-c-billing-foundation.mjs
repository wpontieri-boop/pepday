import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('FAIL FINAL — variável de conexão de teste ausente');
  process.exit(2);
}

const migrationPath = new URL('../supabase/migrations/20260928202253_block_c_billing_foundation.sql', import.meta.url);
let migration = await readFile(migrationPath, 'utf8');
migration = migration.replace(/^\s*begin;\s*/i,'').replace(/\s*commit;\s*$/i,'');

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  application_name: 'pepday-block-c-billing-foundation'
});

const q = v => String(v).replaceAll("'","''");
const userId = randomUUID();
const email = `pepday-billing-${userId}@example.invalid`;
let passed = false;

try {
  await client.connect();
  await client.query('begin');
  const exists = await client.query(`
    select exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='subscriptions' and column_name='billing_status'
    ) as ok
  `);
  if (!exists.rows[0].ok) await client.query(migration);

  await client.query(`
    insert into auth.users(id,email,raw_user_meta_data)
    values('${q(userId)}'::uuid,'${q(email)}','{}'::jsonb)
  `);

  const subscription = await client.query(
    'select id from public.subscriptions where user_id=$1::uuid',
    [userId]
  );
  if (subscription.rowCount !== 1) throw new Error('SUBSCRIPTION_FIXTURE_MISSING');
  const subscriptionId = subscription.rows[0].id;

  const now = new Date();
  const periodStart = new Date(now.getTime()-60_000);
  const periodEnd = new Date(now.getTime()+30*86400_000);
  const approvedAt = new Date(now.getTime()+1_000);

  const apply = async ({
    eventId=randomUUID(), type='subscription_authorized_payment', action='updated',
    resourceId=randomUUID(), effect, eventAt=new Date(), providerSubscriptionId='preapproval-test',
    providerPlanId='plan-test', plan=null, start=null, end=null
  }) => {
    const result = await client.query(`
      select public.apply_billing_event(
        $1,$2,$3,$4,$5::uuid,$6,$7::timestamptz,$8,$9,$10,$11::timestamptz,$12::timestamptz
      ) as result
    `,[
      eventId,type,action,resourceId,subscriptionId,effect,eventAt.toISOString(),
      providerSubscriptionId,providerPlanId,plan,start?.toISOString()??null,end?.toISOString()??null
    ]);
    return result.rows[0].result;
  };

  const approvedEventId = randomUUID();
  const approved = await apply({
    eventId:approvedEventId,effect:'payment_approved',eventAt:approvedAt,
    plan:'monthly',start:periodStart,end:periodEnd
  });
  if (approved.outcome !== 'applied' || approved.status !== 'pro_active' ||
      approved.plan !== 'monthly' || approved.billing_status !== 'active') {
    throw new Error('APPROVED_PAYMENT_NOT_APPLIED');
  }

  const duplicate = await apply({
    eventId:approvedEventId,effect:'payment_approved',eventAt:approvedAt,
    plan:'monthly',start:periodStart,end:periodEnd
  });
  if (duplicate.outcome !== 'duplicate' || duplicate.billing_version !== 1) {
    throw new Error('DUPLICATE_NOT_IDEMPOTENT');
  }

  const stale = await apply({
    effect:'subscription_canceled',
    eventAt:new Date(approvedAt.getTime()-1_000),
    type:'subscription_preapproval'
  });
  if (stale.outcome !== 'stale') throw new Error('STALE_EVENT_NOT_REJECTED');

  const canceledAt = new Date(approvedAt.getTime()+2_000);
  const canceled = await apply({
    effect:'subscription_canceled',eventAt:canceledAt,type:'subscription_preapproval'
  });
  if (canceled.outcome !== 'applied' || canceled.status !== 'pro_active' ||
      canceled.billing_status !== 'canceled' || canceled.cancel_at_period_end !== true) {
    throw new Error('CANCELLATION_DID_NOT_KEEP_PAID_ACCESS');
  }

  const reactivated = await apply({
    effect:'subscription_reactivated',
    eventAt:new Date(canceledAt.getTime()+1_000),
    type:'subscription_preapproval'
  });
  if (reactivated.outcome !== 'applied' || reactivated.status !== 'pro_active' ||
      reactivated.billing_status !== 'active' || reactivated.cancel_at_period_end !== false) {
    throw new Error('REACTIVATION_FAILED');
  }

  const renewalFailedAt = new Date(canceledAt.getTime()+2_000);
  const renewalFailed = await apply({
    effect:'renewal_failed',eventAt:renewalFailedAt
  });
  const graceUntil = new Date(renewalFailed.grace_until);
  const expectedGrace = renewalFailedAt.getTime()+3*86400_000;
  if (renewalFailed.billing_status !== 'grace' || renewalFailed.status !== 'pro_active' ||
      Math.abs(graceUntil.getTime()-expectedGrace)>1_000) {
    throw new Error('THREE_DAY_GRACE_FAILED');
  }

  const direct = await client.query(`
    select status,plan,billing_status,last_payment_status,cancel_at_period_end,
           extract(epoch from (grace_until-$1::timestamptz))::bigint as grace_seconds,
           billing_version
    from public.subscriptions where id=$2::uuid
  `,[renewalFailedAt.toISOString(),subscriptionId]);
  const row = direct.rows[0];
  if (row.status !== 'pro_active' || row.plan !== 'monthly' || row.billing_status !== 'grace' ||
      row.last_payment_status !== 'rejected' || row.cancel_at_period_end !== false ||
      Number(row.grace_seconds)!==259200) {
    throw new Error('BILLING_STATE_INCONSISTENT');
  }

  const privilege = await client.query(`
    select
      has_function_privilege('anon',
        'public.apply_billing_event(text,text,text,text,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz)',
        'execute') as anon_exec,
      has_function_privilege('authenticated',
        'public.apply_billing_event(text,text,text,text,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz)',
        'execute') as auth_exec,
      has_table_privilege('anon','public.billing_events','select') as anon_select,
      has_table_privilege('authenticated','public.billing_events','select') as auth_select
  `);
  if (Object.values(privilege.rows[0]).some(Boolean)) throw new Error('BILLING_PRIVILEGE_LEAK');

  const events = await client.query(
    'select outcome,count(*)::int n from public.billing_events where subscription_id=$1::uuid group by outcome',
    [subscriptionId]
  );
  const counts = Object.fromEntries(events.rows.map(r=>[r.outcome,r.n]));
  if ((counts.applied??0)!==4 || (counts.stale??0)!==1) {
    throw new Error('BILLING_EVENT_LEDGER_INCONSISTENT');
  }

  await client.query('rollback');
  passed = true;
  console.log('PASS FINAL BLOCO C BILLING FOUNDATION — aprovação + idempotência + stale + cancelamento + reativação + tolerância 3 dias + privilégios');
} catch (error) {
  try { await client.query('rollback'); } catch {}
  const code = String(error?.code || error?.message || 'UNKNOWN').replace(/[^A-Z0-9_.-]/gi,'_').slice(0,120);
  console.error(`FAIL FINAL BLOCO C BILLING FOUNDATION — ${code}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(()=>{});
  if (!passed && process.exitCode == null) process.exitCode = 1;
}
