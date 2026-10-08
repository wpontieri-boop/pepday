import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {pathToFileURL} from 'node:url';

test('build público separa landing, app, admin e cartão',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'pepday-public-'));
  try{
    const result=spawnSync(process.execPath,['scripts/build-public.mjs','--out',dir],{
      cwd:new URL('..',import.meta.url),
      encoding:'utf8'
    });
    assert.equal(result.status,0,result.stderr||result.stdout);

    const [
      landing,app,admin,card,rootConfig,appConfig,
      rootFirebaseConfig,appFirebaseConfig,rootFirebaseWorker,appFirebaseWorker
    ]=await Promise.all([
      readFile(path.join(dir,'index.html'),'utf8'),
      readFile(path.join(dir,'app','index.html'),'utf8'),
      readFile(path.join(dir,'admin','index.html'),'utf8'),
      readFile(path.join(dir,'cartao','index.html'),'utf8'),
      readFile(path.join(dir,'config.js'),'utf8'),
      readFile(path.join(dir,'app','config.js'),'utf8'),
      readFile(path.join(dir,'src','firebase-public-config.mjs'),'utf8'),
      readFile(path.join(dir,'app','src','firebase-public-config.mjs'),'utf8'),
      readFile(path.join(dir,'src','firebase-messaging-sw.js'),'utf8'),
      readFile(path.join(dir,'app','src','firebase-messaging-sw.js'),'utf8')
    ]);

    assert.match(landing,/Seus cálculos e sua rotina de peptídeos/);
    assert.doesNotMatch(landing,/Resumo de hoje/);
    assert.match(landing,/href="\/app\/\?from=site"/);
    assert.match(app,/Resumo de hoje/);
    assert.doesNotMatch(app,/V3\.0 — TESTES/);
    for(const builtConfig of [rootConfig,appConfig]){
      assert.match(builtConfig,/environment:\s*'production'/);
      assert.match(builtConfig,/oslefjmwfnddxlotalxu/);
      assert.match(builtConfig,/https:\/\/pepday\.com\.br\/app\//);
      assert.doesNotMatch(builtConfig,/fsbqpyyprtymwrmzsacp/);
      assert.doesNotMatch(builtConfig,/homologacao\.pepday\.com\.br/);
    }
    for(const builtFirebaseConfig of [rootFirebaseConfig,appFirebaseConfig]){
      assert.match(builtFirebaseConfig,/pepday-v3-prod/);
      assert.match(builtFirebaseConfig,/283848852406/);
      assert.match(builtFirebaseConfig,/BEVAKiJcE3XcTwSmyxbCwE6d3-x_2WUcuTqsZiq02YVAuK-hzQ9u3hXkBFQVkZvkMz9yGIgz4MtRfgeYL3DxTwA/);
      assert.doesNotMatch(builtFirebaseConfig,/pepday-v3-test/);
    }
    for(const builtFirebaseWorker of [rootFirebaseWorker,appFirebaseWorker]){
      assert.match(builtFirebaseWorker,/pepday-v3-prod/);
      assert.match(builtFirebaseWorker,/283848852406/);
      assert.doesNotMatch(builtFirebaseWorker,/pepday-v3-test/);
    }
    assert.match(admin,/PAINEL PRIVADO/);
    assert.match(admin,/noindex,nofollow/);
    assert.match(card,/href="\/app\/\?from=cartao"/);
    assert.match(await readFile(path.join(dir,'admin','parceiros','index.html'),'utf8'),/Parceiros/);
    const acquisition=await import(pathToFileURL(path.join(dir,'app','src','acquisition.mjs')).href);
    const referral=await import(pathToFileURL(path.join(dir,'app','src','partner-referral.mjs')).href);
    const map=new Map(),storage={setItem:(k,v)=>map.set(k,v),getItem:k=>map.get(k)||null,removeItem:k=>map.delete(k)};
    referral.saveReferralToken('a'.repeat(64),storage);acquisition.captureCardAcquisition(storage);
    assert.ok(map.has('pepday.production.oslefjmwfnddxlotalxu.referral.v1'));
    await acquisition.claimPendingCardAcquisition({rpc:async(name,args)=>{
      assert.equal(name,'claim_partner_card_acquisition');assert.equal(args.p_intent_token,'a'.repeat(64));
      return {data:{benefit:{code:'CARD_PRO_GRANTED'}},error:null};
    }},storage,{location:{hostname:'pepday.com.br'}});
    assert.equal(referral.readReferralToken(storage),null);
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});
