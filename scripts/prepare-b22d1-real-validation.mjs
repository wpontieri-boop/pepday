import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_FILES = [
  '00_preflight.sql',
  '10_prepare.sql',
  '20_create_session_a.sql',
  '21_create_session_b.sql',
  '30_update_delete_session_a.sql',
  '31_update_delete_session_b.sql',
  '90_verify.sql',
  '99_cleanup.sql',
];

export function evaluateOverlap(evidence, minimumWaitMs = 7000) {
  if (!evidence?.a_lock_acquired_at || !evidence?.a_sleep_finished_at
    || !evidence?.b_started_at || !evidence?.b_finished_at) return false;
  const lock = Date.parse(evidence.a_lock_acquired_at);
  const release = Date.parse(evidence.a_sleep_finished_at);
  const start = Date.parse(evidence.b_started_at);
  const finish = Date.parse(evidence.b_finished_at);
  return [lock, release, start, finish].every(Number.isFinite)
    && Number(evidence.b_wait_ms) >= minimumWaitMs
    && lock <= start && start < release && release <= finish;
}

export function createRunValues() {
  const runMarker = randomUUID();
  return {
    RUN_MARKER: runMarker,
    USER_ID: randomUUID(),
    MARKER_ID: randomUUID(),
    VIAL_ID: randomUUID(),
    CREATE_OP_A: randomUUID(),
    CREATE_OP_B: randomUUID(),
    UPDATE_OP_A: randomUUID(),
    DELETE_OP_B: randomUUID(),
    SOURCE_HASH: createHash('sha256').update(`pepday-b22d1:${runMarker}`).digest('hex'),
    FIXTURE_EMAIL: `pepday-b22d1-${runMarker.replaceAll('-', '')}@example.invalid`,
  };
}

export async function generatePackage({ outputDir, values = createRunValues() } = {}) {
  const destination = outputDir ?? join(tmpdir(), `pepday-b22d1-real-${values.RUN_MARKER}`);
  const templateDir = new URL('../supabase/tests/block_b22d1_real_concurrency/', import.meta.url);
  await mkdir(destination, { recursive: false });
  for (const file of EXPECTED_FILES) {
    let sql = await readFile(new URL(`${file}.template`, templateDir), 'utf8');
    for (const [key, value] of Object.entries(values)) sql = sql.replaceAll(`__${key}__`, value);
    if (/__[A-Z0-9_]+__/.test(sql)) throw new Error(`Placeholder não resolvido em ${file}.`);
    await writeFile(join(destination, file), sql, { encoding: 'utf8', flag: 'wx' });
  }
  await writeFile(join(destination, 'run.json'), `${JSON.stringify(values, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { outputDir: destination, values, files: EXPECTED_FILES };
}

const isMain = process.argv[1]
  && pathToFileURL(fileURLToPath(new URL(import.meta.url))).href === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const generated = await generatePackage();
    console.log(`Pacote B2.2-D1 gerado em: ${generated.outputDir}`);
    console.log(`run_marker: ${generated.values.RUN_MARKER}`);
  } catch (error) {
    console.error(`Falha ao gerar pacote B2.2-D1: ${error.message}`);
    process.exitCode = 1;
  }
}
