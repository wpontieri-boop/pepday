// Somente pepday-v3-test; credencial exclusivamente via ambiente.
import { pathToFileURL } from 'node:url';
import { buildPackage, PROJECT_REF } from './prepare-b22d2f-real-validation.mjs';
import { validateDatabaseUrl, sanitizeError } from './test-b22d1-real-concurrency.mjs';

export function validateD2fDatabaseUrl(value) {
  validateDatabaseUrl(value);
  const url=new URL(value);
  const direct=url.hostname===`db.${PROJECT_REF}.supabase.co` && url.username==='postgres';
  const sessionPooler=url.hostname.endsWith('.pooler.supabase.com')
    && url.username===`postgres.${PROJECT_REF}` && url.port==='5432';
  if ((!direct && !sessionPooler) || url.pathname!=='/postgres') {
    throw new Error('Use a conexão direta ou Session pooler do pepday-v3-test, banco postgres.');
  }
  return value;
}

export async function executePackage(query, pack = buildPackage()) {
  let primaryError;
  let cleanupError;
  try {
    await query('admin', pack.setup);
    for (const scenario of pack.scenarios) {
      // Todos os rejeitados são recolhidos antes do cleanup.
      const a = query('a', scenario.sqlA);
      const b = new Promise(resolve=>setTimeout(resolve,500)).then(()=>query('b',scenario.sqlB));
      const observer = query('admin',scenario.observeAndRecord);
      const results = await Promise.allSettled([a,b,observer]);
      const failure = results.find(r=>r.status==='rejected');
      if (failure) throw new Error(`${scenario.name}: ${sanitizeError(failure.reason)}`);
    }
    await query('admin',pack.verify);
  } catch(error) { primaryError=error; }
  finally {
    await Promise.allSettled(['a','b','admin'].map(name=>query(name,'rollback')));
    try {
      // Setup pode ter confirmado antes de uma falha de transporte.
      const found=await query('admin',`select count(*)::int n from public.local_data_imports where id='${pack.ids.importId}' and user_id='${pack.ids.user}'`);
      if (found.rows[0].n===1) await query('admin',pack.cleanup);
      const remaining=await query('admin',pack.remaining);
      if (Number(remaining.rows[0].total_fixtures)!==0) throw new Error('Fixtures remanescentes');
    } catch(error) { cleanupError=error; }
  }
  if (primaryError || cleanupError) throw new Error([primaryError&&`validação: ${sanitizeError(primaryError)}`,cleanupError&&`cleanup: ${sanitizeError(cleanupError)}`].filter(Boolean).join('; '));
  return 'PASS FINAL D2-F — 6 cenários com lock observado e cleanup zero';
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const clients={};
  try {
    const connectionString=validateD2fDatabaseUrl(process.env.SUPABASE_DB_URL);
    const {Client}=await import('pg');
    for (const name of ['admin','a','b']) {
      const client=new Client({connectionString,connectionTimeoutMillis:15000,query_timeout:40000,
        ssl:{rejectUnauthorized:true},application_name:`pepday-d2f-${name}`});
      client.on('error',()=>{});
      clients[name]=client;
      await client.connect();
    }
    console.log(await executePackage((name,sql)=>clients[name].query(sql)));
  } catch(error) { console.error(`FAIL D2-F — ${sanitizeError(error)}`); process.exitCode=1; }
  finally { await Promise.allSettled(Object.values(clients).map(async client=>{
    const timer=setTimeout(()=>client.connection?.stream?.destroy(),5000);
    try { await client.end(); } finally { clearTimeout(timer); }
  })); }
}
