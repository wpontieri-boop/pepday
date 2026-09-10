import { inspectLegacy, snapshotLegacy, stageLegacyImport } from './legacy-import.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;

export function reviewLegacy(storage) {
  const data=inspectLegacy(storage);
  const errors=data.issues.filter(message=>!message.startsWith('Preservar histórico legado'));
  const nameOK=value=>typeof value==='string' && value.trim().length>0 && value.trim().length<=200;
  if(data.vials.length+data.routines.length>2000) errors.push('O limite por importação é de 2000 registros.');
  for(const v of data.vials) {
    if(!v || !nameOK(v.name) || !validDate(v.date) ||
      (v.cost!=null && (typeof v.cost!=='number' || !Number.isFinite(v.cost) || v.cost<0 || v.cost>=1e9)) ||
      v.initialMg>=1e9 || v.waterMl>=1e9) errors.push('Revise nome, data ou custo de um frasco.');
  }
  for(const r of data.routines) {
    if(!r || !nameOK(r.name) || !validDate(r.start) ||
      (r.time!=null && r.time!=='' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) ||
      (r.weekdays!=null && (!Array.isArray(r.weekdays) || r.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))) ||
      (r.frequency==='weekdays' && !r.weekdays?.length) ||
      (r.refillAt!=null && ![2,3,4,5].includes(r.refillAt)) ||
      (r.done!=null && !Array.isArray(r.done)) || (r.doseHistory!=null && !Array.isArray(r.doseHistory)) || r.doseValue>=1e9) {
      errors.push('Revise nome, data, horário ou frequência de uma rotina.'); continue;
    }
    const v=data.vials.find(v=>v?.id===r.vialId);
    if(v && (r.doseValue/(r.doseUnit==='mcg'?1000:1))/(v.initialMg/v.waterMl)*100>r.syringeCapacity) {
      errors.push('A preparação atual excede a seringa de uma rotina. Revise antes de importar.');
    }
  }
  return {...data,errors};
}

async function assertAccount(client,userId) {
  const result=await client.auth.getUser();
  if(result.error || result.data?.user?.id!==userId) throw new Error('Confira a conta antes de importar.');
}

export async function readCloudInventory(client,userId) {
  await assertAccount(client,userId);
  const results=await Promise.all(['vials','routines'].map(table=>client.from(table)
    .select('id',{count:'exact',head:true}).eq('user_id',userId)));
  for(const r of results) if(r.error || !Number.isInteger(r.count)) throw new Error('Não foi possível conferir os dados da conta.');
  return {vials:results[0].count,routines:results[1].count,hasData:results.some(r=>r.count>0)};
}

export function verifyImportReceipt(receipt,{userId,hash,importId,review}) {
  const expected=new Set([
    ...review.vials.map(v=>`vial:${v.id.toLowerCase()}`),
    ...review.routines.map(r=>`routine:${r.id.toLowerCase()}`)
  ]);
  if(!receipt || receipt.user_id!==userId || receipt.source_hash!==hash || receipt.import_id!==importId ||
    receipt.status!=='completed' || !receipt.completed_at || !Array.isArray(receipt.records) ||
    receipt.records.length!==expected.size) throw new Error('A importação ainda não foi conferida. Cópia local preservada.');
  for(const r of receipt.records) {
    if(!expected.delete(`${r.kind}:${r.legacy_id}`) || r.verified!==true || !uuid.test(r.target_id)) {
      throw new Error('Divergência na conferência da importação.');
    }
  }
  return true;
}

export async function completeLegacyImport(client,storage,{consent,expectedUserId,mode}) {
  if(consent!==true || !['import','merge'].includes(mode)) throw new Error('Escolha e consentimento necessários.');
  const review=reviewLegacy(storage);
  if(review.errors.length) throw new Error('Revise os dados locais antes de importar.');
  const backup=await snapshotLegacy(storage);
  if(!backup.hasData) return {status:'empty'};
  const staged=await stageLegacyImport(client,storage,{consent,expectedUserId});
  const current=await snapshotLegacy(storage);
  if(current.hash!==backup.hash) throw new Error('Dados locais alterados durante a importação. Revise novamente.');
  await assertAccount(client,expectedUserId);
  const result=await client.rpc('complete_local_import',{
    p_import_id:staged.importId,p_expected_user:expectedUserId,p_hash:backup.hash,p_mode:mode
  });
  if(result.error) throw result.error;
  // Uma segunda leitura permite recuperar resposta perdida e conferir o estado persistido.
  const read=await client.rpc('get_local_import_receipt',{p_import_id:staged.importId,p_expected_user:expectedUserId});
  if(read.error) throw read.error;
  verifyImportReceipt(read.data,{userId:expectedUserId,hash:backup.hash,importId:staged.importId,review});
  await assertAccount(client,expectedUserId);
  if((await snapshotLegacy(storage)).hash!==backup.hash) throw new Error('A cópia enviada foi concluída, mas há novas alterações locais para revisar.');
  const markerKey=`pepday_v3_import_completed_${expectedUserId}_${backup.hash}`;
  const marker=JSON.stringify({importId:staged.importId,completedAt:read.data.completed_at});
  storage.setItem(markerKey,marker);
  if(storage.getItem(markerKey)!==marker) throw new Error('Importação no servidor concluída; confirmação local pendente. Tente novamente.');
  return {status:'completed',importId:staged.importId,receipt:read.data};
}
