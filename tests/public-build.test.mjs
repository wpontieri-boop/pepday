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

    const [landing,app,admin,card]=await Promise.all([
      readFile(path.join(dir,'index.html'),'utf8'),
      readFile(path.join(dir,'app','index.html'),'utf8'),
      readFile(path.join(dir,'admin','index.html'),'utf8'),
      readFile(path.join(dir,'cartao','index.html'),'utf8')
    ]);

    assert.match(landing,/Mais clareza para sua rotina/);
    assert.doesNotMatch(landing,/Resumo de hoje/);
    assert.match(landing,/href="\/app\/\?from=site"/);
    assert.match(app,/Resumo de hoje|PEPDAY · V3\.0 — TESTES/);
    assert.match(admin,/PAINEL PRIVADO/);
    assert.match(admin,/noindex,nofollow/);
    assert.match(card,/href="\/app\/\?from=cartao"/);
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});
