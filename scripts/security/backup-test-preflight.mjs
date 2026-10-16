// Local inventory only: never reads credentials, dumps data, uploads or restores.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const manifestUrl = new URL('../../infra/hostinger-security-test/backup-target.test.json', import.meta.url);
const tools = ['pg_dump', 'pg_restore', 'psql'];
export function postgres17(tool, output) {
  return tools.includes(tool) && typeof output === 'string'
    && new RegExp(`^${tool} \\(PostgreSQL\\) 17\\.\\d+(?:\\.\\d+)?(?:[ \\r\\n]|$)`).test(output);
}
export function inspectPostgres17(run = spawnSync) {
  return Object.fromEntries(tools.map(tool => {
    let compatible = false;
    try {
      const result = run(tool, ['--version'], {
        shell:false, windowsHide:true, encoding:'utf8', timeout:5000, maxBuffer:4096,
      });
      compatible = result.status === 0 && !result.error && postgres17(tool, result.stdout);
    } catch { /* Do not print arbitrary subprocess output or environment. */ }
    return [tool, compatible];
  }));
}
export function backupPreflight(manifest, runtime = {}) {
  const blockers = [];
  const require = (condition, code) => { if (!condition) blockers.push(code); };
  require(manifest?._scope === 'PEPDAY_TEST_ONLY'
    && manifest?._status === 'PREPARATION_ONLY_NOT_DEPLOYED'
    && manifest?.source?.provider === 'supabase'
    && manifest?.source?.project_id === 'fsbqpyyprtymwrmzsacp'
    && manifest?.source?.database_major === 17, 'INVALID_TEST_SCOPE');
  for (const flag of ['enabled','database_export_enabled','storage_export_enabled','upload_enabled',
    'scheduled_jobs_enabled','restore_enabled','production_access_allowed'])
    require(manifest?.[flag] === false, 'EXECUTION_FLAG_NOT_OFF');
  const security = manifest?.security;
  require(security?.encryption_algorithm === 'AES-256-GCM'
    && ['encryption_required_before_upload','manifest_sha256_required',
      'secret_must_remain_off_drive_off_git_off_vps','no_plaintext_cloud_fallback',
      'no_central_ia_database_or_volumes'].every(k => security?.[k] === true), 'UNSAFE_BACKUP_POLICY');
  require(manifest?.source?.include_storage_object_bytes === true, 'STORAGE_BYTES_REQUIRED');
  require(manifest?.destination?.provider === 'google_drive'
    && manifest?.destination?.folder_id === '1eM-rWJoBTkhNrxfTVAhoJ0PfiY859XMO'
    && manifest?.destination?.shared === false, 'INVALID_PRIVATE_DRIVE_DESTINATION');
  require(manifest?.activation_gates?.encryption_key_custodian_confirmed === true, 'CUSTODY_UNCONFIRMED');
  for (const tool of tools) require(runtime[tool] === true, `POSTGRES17_${tool.toUpperCase()}_UNAVAILABLE`);
  // These are operational proofs, deliberately not satisfiable by changing manifest booleans.
  blockers.push('PROTECTED_TEST_CREDENTIALS_NOT_VERIFIED', 'ISOLATED_RESTORE_TARGET_NOT_AUTHORIZED',
    'STORAGE_EXPORT_NOT_IMPLEMENTED', 'ENCRYPTED_DRIVE_ROUNDTRIP_NOT_PROVEN',
    'REAL_RESTORE_NOT_PROVEN', 'SCHEDULE_RETENTION_ALERTS_NOT_CONFIGURED');
  return {status:'BLOCKED_PREPARATION_ONLY', executionAllowed:false,
    blockers:[...new Set(blockers)], networkAccess:false, credentialAccess:false};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    console.error('BACKUP_PREFLIGHT_NO_ARGUMENTS_ALLOWED'); process.exitCode = 2;
  } else {
    const report = backupPreflight(JSON.parse(readFileSync(manifestUrl,'utf8')), inspectPostgres17());
    console.log(JSON.stringify(report,null,2));
    process.exitCode = 3; // Expected: inventory never authorizes execution.
  }
}
