export const LEGACY_KEYS = Object.freeze([
  'pepday_v1_routines', 'pepday_v2_vials', 'pepday_tutorial_v29_seen'
]);

function readArray(raw, name) {
  if (raw === null) return [];
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${name}: dados locais inválidos. Nada foi apagado.`); }
  if (!Array.isArray(value)) throw new Error(`${name}: formato inesperado. Nada foi apagado.`);
  return value;
}

export function inspectLegacy(storage) {
  const raw = Object.fromEntries(LEGACY_KEYS.map(key => [key, storage.getItem(key)]));
  const routines = readArray(raw.pepday_v1_routines, 'Rotinas');
  const vials = readArray(raw.pepday_v2_vials, 'Frascos');
  const issues = [];
  const vialIds = new Set();
  const routineIds = new Set();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validNumber = n => typeof n === 'number' && Number.isFinite(n);
  for (const v of vials) {
    if (!v || typeof v !== 'object') { issues.push('Frasco em formato inválido.'); continue; }
    if (!uuid.test(v.id) || vialIds.has(v.id)) issues.push('Frasco com identificador inválido ou repetido.');
    vialIds.add(v.id);
    if (!validNumber(v.initialMg) || v.initialMg <= 0 || !validNumber(v.waterMl) || v.waterMl <= 0 ||
        !validNumber(v.remainingMg) || v.remainingMg < 0 || v.remainingMg > v.initialMg) {
      issues.push(`Revisar preparação/saldo do frasco ${v.id}.`);
    }
    // V2.9 pode remover o evento original em undo e não conserva a concentração
    // histórica. Nunca fabricar esses campos para satisfazer o esquema novo.
    if (v.history != null && !Array.isArray(v.history)) issues.push(`Histórico inválido no frasco ${v.id}.`);
    if (Array.isArray(v.history) && v.history.length) issues.push(`Preservar histórico legado do frasco ${v.id} para revisão.`);
  }
  for (const r of routines) {
    if (!r || typeof r !== 'object') { issues.push('Rotina em formato inválido.'); continue; }
    if (!uuid.test(r.id) || routineIds.has(r.id)) issues.push('Rotina com identificador inválido ou repetido.');
    routineIds.add(r.id);
    if (!vialIds.has(r.vialId)) issues.push(`Rotina ${r.id} sem frasco válido.`);
    if (!['daily', 'alternate', '5on2off', 'weekdays'].includes(r.frequency)) issues.push(`Frequência inválida na rotina ${r.id}.`);
    if (!validNumber(r.doseValue) || r.doseValue <= 0 || !['mg','mcg'].includes(r.doseUnit)) issues.push(`Quantidade inválida na rotina ${r.id}.`);
    if (![30,50,100].includes(r.syringeCapacity)) issues.push(`Seringa inválida na rotina ${r.id}.`);
  }
  return { sourceVersion: '2.9', raw, routines, vials, issues,
    hasData: routines.length > 0 || vials.length > 0 };
}

export async function snapshotLegacy(storage, cryptoProvider = globalThis.crypto) {
  const data = inspectLegacy(storage);
  // Hash dos bytes originais, independente do momento ou da conta de destino.
  const canonical = JSON.stringify(data.raw);
  const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const snapshot = { sourceVersion: data.sourceVersion, raw: data.raw };
  const backupKey = `pepday_v3_backup_${hash}`;
  const serialized = JSON.stringify(snapshot);
  // Falha de quota impede envio. A cópia deve existir e ser conferida primeiro.
  const existing = storage.getItem(backupKey);
  if (existing !== null && existing !== serialized) throw new Error('Conflito no backup local.');
  if (existing === null) storage.setItem(backupKey, serialized);
  if (storage.getItem(backupKey) !== serialized) throw new Error('Não foi possível verificar o backup local.');
  return { hash, snapshot, backupKey, issues: data.issues, hasData: data.hasData };
}

export async function stageLegacyImport(client, storage, { consent, expectedUserId }) {
  if (consent !== true) throw new Error('A importação depende da escolha explícita do usuário.');
  const identity = await client.auth.getUser();
  if (identity.error || !identity.data?.user?.id || identity.data.user.id !== expectedUserId) {
    throw new Error('Confira a conta antes de importar.');
  }
  const backup = await snapshotLegacy(storage);
  if (!backup.hasData) return { status: 'empty' };
  const result = await client.rpc('stage_local_import', { p_hash: backup.hash, p_snapshot: backup.snapshot });
  if (result.error) throw result.error;
  const verified = await client.from('local_data_imports')
    .select('id,user_id,source_hash,source_snapshot,status')
    .eq('id', result.data).eq('user_id', expectedUserId).single();
  if (verified.error) throw verified.error;
  const record = verified.data;
  if (!record || record.user_id !== expectedUserId || record.source_hash !== backup.hash ||
      record.source_snapshot?.sourceVersion !== backup.snapshot.sourceVersion ||
      LEGACY_KEYS.some(k => record.source_snapshot?.raw?.[k] !== backup.snapshot.raw[k])) {
    throw new Error('Falha na conferência do envio. Backup local preservado.');
  }
  // Não confundir snapshot recebido com dados convertidos/sincronizados.
  return { status: 'staged', importId: record.id, issues: backup.issues, backupKey: backup.backupKey };
}
