import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('build público separa landing, app, admin e cartão',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'pepday-public-'));
  try{
    const result=spawnSync(process.execPath,['scripts/build-public.mjs','--out',dir],{
      cwd:new URL('..',import.meta.url),
      encoding:'utf8'
    });
    assert.equal(result.status,0,result.stderr||result.stdout);

    const [landing,app,admin,card,rootConfig,appConfig]=await Promise.all([
      readFile(path.join(dir,'index.html'),'utf8'),
      readFile(path.join(dir,'app','index.html'),'utf8'),
      readFile(path.join(dir,'admin','index.html'),'utf8'),
      readFile(path.join(dir,'cartao','index.html'),'utf8'),
      readFile(path.join(dir,'config.js'),'utf8'),
      readFile(path.join(dir,'app','config.js'),'utf8')
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
    assert.match(admin,/PAINEL PRIVADO/);
    assert.match(admin,/noindex,nofollow/);
    assert.match(card,/href="\/app\/\?from=cartao"/);
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});
