import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureCardAcquisition, readAcquisition } from '../src/acquisition.mjs';

class MemoryStorage{
  constructor(){this.map=new Map()}
  setItem(k,v){this.map.set(k,String(v))}
  getItem(k){return this.map.has(k)?this.map.get(k):null}
  removeItem(k){this.map.delete(k)}
}

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('cartão grava origem first-touch padronizada',()=>{
  const storage=new MemoryStorage(),now=new Date('2026-09-28T20:00:00Z');
  const marker=captureCardAcquisition(storage,now);
  assert.deepEqual({...marker},{
    source:'card',medium:'qr',campaign:'cartao-v1',landingPath:'/cartao/',firstSeenAt:'2026-09-28T20:00:00.000Z'
  });
  assert.deepEqual({...readAcquisition(storage)},{...marker});
});

test('captura posterior não sobrescreve primeiro acesso',()=>{
  const storage=new MemoryStorage();
  const first=captureCardAcquisition(storage,new Date('2026-09-01T10:00:00Z'));
  const second=captureCardAcquisition(storage,new Date('2026-09-28T10:00:00Z'));
  assert.deepEqual({...second},{...first});
});

test('landing /cartao registra origem e comunica benefício sem inventar percentual',async()=>{
  const html=await read('cartao/index.html');
  assert.match(html,/captureCardAcquisition\(\)/);
  assert.match(html,/href="\.\.\/\?from=cartao"/);
  assert.match(html,/BENEFÍCIO EXCLUSIVO DO CARTÃO/);
  assert.match(html,/Condições exclusivas poderão ser disponibilizadas para este acesso/);
  assert.match(html,/descubra as condições exclusivas disponíveis para você/i);
  assert.doesNotMatch(html,/\d+%\s*(off|desconto)/i);
});

test('backend de atribuição é first-touch e não concede benefício',async()=>{
  const sql=await read('supabase/migrations/20260928205127_block_c_acquisition_attribution.sql');
  assert.match(sql,/unique references public\.profiles\(id\)/);
  assert.match(sql,/source='card'/);
  assert.match(sql,/medium='qr'/);
  assert.match(sql,/campaign='cartao-v1'/);
  assert.match(sql,/on conflict\(user_id\) do nothing/);
  assert.match(sql,/grant execute on function public\.claim_card_acquisition\(timestamptz\) to authenticated/);
  assert.doesNotMatch(sql,/update\s+public\.subscriptions|apply_billing_event|grant\s+.*pro_active/i);
});

test('conta reivindica atribuição somente depois do cadastro completo',async()=>{
  const account=await read('src/account-ui.mjs');
  assert.match(account,/if\(complete\)claimPendingCardAcquisition\(cloud\.client\)/);
  assert.match(account,/from'\)==='cartao'\)captureCardAcquisition\(\)/);
});

test('servidor local aceita /cartao e cache inclui landing e módulo',async()=>{
  const [server,sw]=await Promise.all([read('scripts/dev-server.mjs'),read('sw.js')]);
  assert.match(server,/rawPath==='cartao'\|\|rawPath==='cartao\/'\?'cartao\/index\.html'/);
  assert.match(server,/src\/acquisition\.mjs/);
  assert.match(sw,/\.\/cartao\//);
  assert.match(sw,/\.\/src\/acquisition\.mjs/);
});
