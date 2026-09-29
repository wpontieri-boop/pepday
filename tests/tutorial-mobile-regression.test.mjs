import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('tutorial usa token interno para navegar visualmente em telas PRO sem abrir gate',async()=>{
  const source=await read('app.js');
  assert.match(source,/const tutorialNavigationToken=Object\.freeze\(\{\}\)/);
  assert.match(source,/navigationToken===tutorialNavigationToken/);
  assert.match(source,/proScreens\.has\(id\)&&!tutorialDemo&&!requirePro/);
  assert.match(source,/const entered=go\(step\.screen,tutorialNavigationToken\)/);
  assert.doesNotMatch(source,/tutorialDemo:true/);
});

test('tutorial não concede entitlement nem usa APIs de mutação para demonstração',async()=>{
  const source=await read('app.js');
  const tutorial=source.slice(source.indexOf('// ===== PepDay V2.9 — Tutorial interativo ====='));
  assert.doesNotMatch(tutorial,/startTrial\(|saveRoutineWithOutbox|saveVialWithOutbox|enqueueApplicationIntent|PepDayAccess\s*=|entitlement/);
});

test('spotlight cria recorte transparente e mantém alvo legível',async()=>{
  const css=await read('style.css');
  assert.match(css,/\.tutorial-dim\{[^}]*background:transparent/);
  assert.match(css,/\.tutorial-spotlight\{[^}]*background:transparent/);
  assert.match(css,/box-shadow:0 0 0 9999px rgba\(0,7,12,\.79\)/);
});

test('card do tutorial fica limitado ao viewport e respeita safe-area',async()=>{
  const [source,css]=await Promise.all([read('app.js'),read('style.css')]);
  assert.match(source,/window\.visualViewport/);
  assert.match(source,/viewBottom-cardH-margin/);
  assert.match(source,/Math\.min\(maxTop,Math\.max\(viewTop\+margin,preferredTop\)\)/);
  assert.match(css,/max-height:calc\(100dvh - 24px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/overflow-y:auto/);
});

test('tutorial reposiciona com resize e scroll do visual viewport',async()=>{
  const source=await read('app.js');
  assert.match(source,/window\.visualViewport\?\.addEventListener\('resize',repositionTutorial\)/);
  assert.match(source,/window\.visualViewport\?\.addEventListener\('scroll',repositionTutorial\)/);
  assert.match(source,/window\.addEventListener\('resize',repositionTutorial\)/);
});
