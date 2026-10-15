import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('public discovery package is build-only and does not enable advertising',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'pepday-public-discovery-'));
  try{
    const result=spawnSync(process.execPath,['scripts/build-public.mjs','--out',dir],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||result.stdout);
    const file=p=>readFile(path.join(dir,p),'utf8');
    const [landing,app,alias,guide,robots,sitemap,adsConfig,adsTxt]=await Promise.all([
      file('index.html'),file('app/index.html'),file('calculadora/index.html'),file('guia-calculadora/index.html'),
      file('robots.txt'),file('sitemap.xml'),file('config.js'),file('ads.txt')
    ]);
    assert.match(landing,/rel="canonical" href="https:\/\/pepday\.com\.br\/"/);
    assert.match(landing,/href="\/calculadora\/">Usar calculadora/);
    assert.match(landing,/href="\/guia-calculadora\/"/);
    assert.match(alias,/<base href="\/app\/">/);
    assert.match(alias,/name="pepday-entry-screen" content="calculator"/);
    assert.match(alias,/id="calculator" class="screen active"/);
    assert.match(alias,/rel="canonical" href="https:\/\/pepday\.com\.br\/calculadora\/"/);
    assert.match(app,/id="home" class="screen active"/);
    assert.doesNotMatch(app,/pepday-entry-screen/);
    assert.match(guide,/href="\/site\.css"/);
    assert.match(guide,/href="\/calculadora\/"/);
    assert.match(guide,/rel="canonical" href="https:\/\/pepday\.com\.br\/guia-calculadora\/"/);
    assert.doesNotMatch(guide,/homologacao\.pepday\.com\.br/);
    assert.match(robots,/Disallow: \/admin\//);
    assert.match(robots,/Sitemap: https:\/\/pepday\.com\.br\/sitemap\.xml/);
    assert.equal((sitemap.match(/<loc>/g)||[]).length,5);
    assert.doesNotMatch(sitemap,/homologacao|admin|cartao|parceiro/);
    assert.match(adsTxt,/google\.com, pub-9704076016670249, DIRECT/);
    assert.match(adsConfig,/enabled:\s*false/);
    assert.doesNotMatch(adsConfig,/enabled:\s*true/);
    assert.doesNotMatch(landing,/name="robots" content="noindex/);
    assert.doesNotMatch(alias,/name="robots" content="noindex/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('tutorial keeps default Home and restores calculator only for explicit entry alias',async()=>{
  const code=await readFile('app.js','utf8');
  const block=code.slice(code.indexOf('function finishTutorial(){'),code.indexOf("tutorialEl('tutorialNext')?.addEventListener",code.indexOf('function finishTutorial(){')));
  assert.match(block,/querySelector\('meta\[name="pepday-entry-screen"\]'\)/);
  assert.match(block,/calculatorEntry\?'calculator':'home'/);
  const sourceApp=await readFile('index.html','utf8');
  assert.doesNotMatch(sourceApp,/pepday-entry-screen/);
});