import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile('app.js','utf8');
const block=source.match(/function finishTutorial\(\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(block,'approved tutorial finish function must exist');

function finishFor(meta){
  const calls=[],writes=[];
  const classes={remove(){},add(){}};
  const document={
    querySelector:()=>meta?{content:meta}:null,
    body:{classList:classes}
  };
  const localStorage={setItem(...args){writes.push(args)}};
  const tutorialEl=()=>({classList:classes});
  const go=id=>calls.push(id);
  const fn=new Function('document','localStorage','tutorialEl','go','tutorialStorageKey',
    'let tutorialActive=true;\n'+block+'\nreturn finishTutorial;');
  fn(document,localStorage,tutorialEl,go,'pepday_tutorial_v29_seen')();
  return {calls,writes};
}

test('tutorial preserves the default Home behavior in the approved app',()=>{
  const result=finishFor(null);
  assert.deepEqual(result.calls,['home']);
  assert.deepEqual(result.writes,[['pepday_tutorial_v29_seen','1']]);
});
test('first-use calculator entry stays in calculator after completing or skipping tutorial',()=>{
  assert.deepEqual(finishFor('calculator').calls,['calculator']);
  assert.deepEqual(finishFor('arbitrary').calls,['home']);
});