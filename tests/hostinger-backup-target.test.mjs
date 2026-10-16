import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file = new URL('../infra/hostinger-security-test/backup-target.test.json', import.meta.url);
const raw = readFileSync(file, 'utf8');
const backup = JSON.parse(raw);

test('destino externo exclusivamente PepDay TEST e Drive correto', () => {
  assert.equal(backup._status, 'PREPARATION_ONLY_NOT_DEPLOYED');
  assert.equal(backup._scope, 'PEPDAY_TEST_ONLY');
  assert.equal(backup.source.provider, 'supabase');
  assert.equal(backup.source.project_id, 'fsbqpyyprtymwrmzsacp');
  assert.equal(backup.source.database_major, 17);
  assert.equal(backup.destination.provider, 'google_drive');
  assert.equal(backup.destination.folder_id, '1eM-rWJoBTkhNrxfTVAhoJ0PfiY859XMO');
  assert.equal(backup.destination.shared, false);
});

test('toda execução e produção desativadas por padrão', () => {
  for (const k of ['enabled','database_export_enabled','storage_export_enabled','upload_enabled','scheduled_jobs_enabled','restore_enabled','production_access_allowed']) {
    assert.equal(backup[k], false, `${k} should stay OFF`);
  }
});

test('criptografia antes de qualquer upload e integridade obrigatórias', () => {
  assert.equal(backup.security.encryption_required_before_upload, true);
  assert.equal(backup.security.encryption_algorithm, 'AES-256-GCM');
  assert.equal(backup.security.manifest_sha256_required, true);
  assert.equal(backup.security.no_plaintext_cloud_fallback, true);
  assert.equal(backup.security.secret_must_remain_off_drive_off_git_off_vps, true);
});

test('todos os requisitos de ativação estão pendentes, sem PASS inventado', () => {
  assert.ok(Object.keys(backup.activation_gates).length >= 6);
  for (const [name, passed] of Object.entries(backup.activation_gates))
    assert.equal(passed, false, `Gate not approved: ${name}`);
});

test('bloqueia acoplamento Central IA e exige bytes Storage', () => {
  assert.equal(backup.security.no_central_ia_database_or_volumes, true);
  assert.equal(backup.source.include_storage_object_bytes, true);
  assert.doesNotMatch(raw, /central-postgres|central_ia_backend|central_ia_cognition/i);
});

test('arquivo contém apenas IDs não secretos, sem credenciais', () => {
  assert.doesNotMatch(raw, /BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|service_role_key|client_secret|access_token|refresh_token|password|bearer /i);
  assert.ok(!Object.keys(backup).some(name => /secret|token|password|credential/i.test(name)));
});
