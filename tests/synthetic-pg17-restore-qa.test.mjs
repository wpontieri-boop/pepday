import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {required,offlineOnly,sealSynthetic,unsealSynthetic} from '../scripts/security/synthetic-pg17-restore-qa.mjs';

test('synthetic drill requires all PostgreSQL tools from local runtime',()=>{
  assert.deepEqual(required,['initdb.exe','pg_ctl.exe','pg_dump.exe','pg_restore.exe','psql.exe','createdb.exe']);
  assert.equal(Boolean(offlineOnly({env:{LOCALAPPDATA:'C:\\safe-local'},tools:required})),true);
  assert.equal(Boolean(offlineOnly({env:{LOCALAPPDATA:'C:\\safe-local',PEPDAY_PROD_RESTORE:'1'},tools:required})),false);
  assert.equal(Boolean(offlineOnly({env:{LOCALAPPDATA:'C:\\safe-local',PEPDAY_ALLOW_REMOTE_BACKUP:'1'},tools:required})),false);
  assert.equal(Boolean(offlineOnly({env:{},tools:required})),false);
});

test('AES256-GCM round-trip succeeds with 32-byte synthetic key',()=>{
  const key=randomBytes(32),source=Buffer.from('QA SYNTHETIC PG17 PAYLOAD');
  const sealed=sealSynthetic(source,key);
  assert.equal(sealed.iv.length,12);
  assert.equal(sealed.tag.length,16);
  assert.notDeepEqual(sealed.data,source);
  assert.deepEqual(unsealSynthetic(sealed,key),source);
  key.fill(0);
});

test('wrong key, modified ciphertext, IV and tag deny decryption',()=>{
  const key=randomBytes(32),sealed=sealSynthetic(Buffer.from('QA ONLY'),key);
  assert.throws(()=>unsealSynthetic(sealed,randomBytes(32)),/SYNTHETIC_AUTH_DENIED/);
  const ciphertext={...sealed,data:Buffer.from(sealed.data)};
  ciphertext.data[0]^=1;
  assert.throws(()=>unsealSynthetic(ciphertext,key),/SYNTHETIC_AUTH_DENIED/);
  const tag={...sealed,tag:Buffer.from(sealed.tag)};
  tag.tag[0]^=1;
  assert.throws(()=>unsealSynthetic(tag,key),/SYNTHETIC_AUTH_DENIED/);
  const iv={...sealed,iv:Buffer.from(sealed.iv)};
  iv.iv[0]^=1;
  assert.throws(()=>unsealSynthetic(iv,key),/SYNTHETIC_AUTH_DENIED/);
  key.fill(0);
});

test('each synthetic envelope uses independent random nonce',()=>{
  const key=randomBytes(32),message=Buffer.from('qa');
  const a=sealSynthetic(message,key),b=sealSynthetic(message,key);
  assert.notEqual(a.iv.toString('hex'),b.iv.toString('hex'));
  key.fill(0);
});

test('runner is restricted to localhost synthetic temp directory with guaranteed stop/cleanup',()=>{
  const file=readFileSync(new URL('../scripts/security/synthetic-pg17-restore-qa.mjs',import.meta.url),'utf8');
  assert.match(file,/server\.listen\(0,'127\.0\.0\.1'/);
  assert.match(file,/listen_addresses = '127\.0\.0\.1'/);
  assert.match(file,/mkdtempSync\(join\(tmpdir\(\)/);
  assert.match(file,/pg_ctl\.exe'.*stop/);
  assert.match(file,/rmSync\(base,\{recursive:true,force:true/);
  assert.match(file,/remoteSupabaseTouched:false,realBackupProven:false/);
  assert.doesNotMatch(file,/supabase\.co|https?:\/\/|Google_Drive|service_role|PEPDAY_REAL_CREDENTIAL/);
});

test('script has no network, database or child process side effects upon importing',()=>{
  assert.equal(typeof sealSynthetic,'function');
  assert.equal(typeof unsealSynthetic,'function');
  assert.equal(typeof offlineOnly,'function');
});
