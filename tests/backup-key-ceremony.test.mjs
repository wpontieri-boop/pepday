import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {Script} from 'node:vm';
const html=readFileSync(new URL('../tools/security/pepday-backup-key.html',import.meta.url),'utf8');

test('offline HTML is restricted to the browser and blocks network connections',()=>{
  assert.match(html,/http-equiv="Content-Security-Policy"/);
  assert.match(html,/default-src 'none'/);
  assert.match(html,/connect-src 'none'/);
  assert.match(html,/form-action 'none'/);
  assert.doesNotMatch(html,/<script\s+src=|<iframe\b|<form\b|<img\b|https?:\/\//i);
});

test('crypto generation uses secure random 32 bytes and SHA256 check, never Math.random',()=>{
  assert.match(html,/new Uint8Array\(32\)/);
  assert.match(html,/crypto\.getRandomValues\(bytes\)/);
  assert.match(html,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(html,/const valid=\/\^\[A-Za-z0-9_-\]\{43\}\$\//);
  assert.doesNotMatch(html,/Math\.random\(/);
});

test('never writes key to storage or transmits it',()=>{
  assert.doesNotMatch(html,/localStorage\.|sessionStorage\.|indexedDB\.|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|window\.location\s*=/);
  assert.match(html,/secret'\)\.value=''/);
  assert.match(html,/check-value'\)\.value=''/);
  assert.match(html,/expectedDigest=null/);
});

test('manual vault recovery is required before verification',()=>{
  assert.match(html,/id="generate"/);
  assert.match(html,/id="saved"/);
  assert.match(html,/id="check-value"/);
  assert.match(html,/id="verify"/);
  assert.match(html,/id="done"/);
  assert.match(html,/sem conexão com servidores/);
  assert.match(html,/nenhuma rotina de backup é ativada/);
});

test('WebCrypto random 256-bit key survives only vault-format roundtrip',async()=>{
  const bytes=new Uint8Array(32);webcrypto.getRandomValues(bytes);
  const encoded=Buffer.from(bytes).toString('base64url');assert.equal(encoded.length,43);
  const restored=Buffer.from(encoded,'base64url');assert.equal(restored.length,32);
  assert.deepEqual(new Uint8Array(restored),bytes);bytes.fill(0);
  assert.equal(bytes.every(x=>x===0),true);
});

test('inline offline key ceremony script is syntactically valid',()=>{
  const match=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(()=>new Script(match[1]));
});

test('backup and key artifacts are excluded from Git by default',()=>{
  const ignore=readFileSync(new URL('../.gitignore',import.meta.url),'utf8');
  for(const needle of ['private-backups/','*.pepday-backup','*.pepday-recovery-key','*.pgdump'])assert.ok(ignore.includes(needle));
});

test('HTML key generator is omitted from public TEST output',()=>{
  const build=readFileSync(new URL('../scripts/build-test.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(build,/['"]tools['"]|tools\/security/);
});
