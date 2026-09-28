const plural=(count,singular,pluralForm=singular+'s')=>`${count} ${count===1?singular:pluralForm}`;

export function summarizeSync(rows,{online=true,paused=false,running=false}={}){
  const list=Array.isArray(rows)?rows:[];
  const counts={pending:0,syncing:0,conflict:0,failed:0,blocked:0};
  for(const row of list){
    if(row?.status in counts)counts[row.status]++;
    if(row?.blockedReason)counts.blocked++;
  }
  const waiting=counts.pending+counts.syncing;
  const problems=counts.conflict+counts.failed;
  if(problems>0)return Object.freeze({
    state:'attention',label:'ATENÇÃO NA SINCRONIZAÇÃO',
    description:`${plural(problems,'item','itens')} precisa${problems===1?'':'m'} de revisão. Seus dados locais foram preservados.`,
    counts
  });
  if(!online)return Object.freeze({
    state:'offline',label:'SEM CONEXÃO',
    description:waiting>0
      ? `${plural(waiting,'alteração','alterações')} aguardando conexão. Seus dados continuam salvos neste aparelho.`
      : 'Seus dados locais continuam disponíveis. A sincronização volta ao reconectar.',
    counts
  });
  if(paused)return Object.freeze({
    state:'paused',label:'SINCRONIZAÇÃO PAUSADA',
    description:waiting>0
      ? `${plural(waiting,'alteração','alterações')} aguardando. Confira sua sessão ou acesso PRO.`
      : 'Confira sua sessão ou acesso PRO para retomar a sincronização.',
    counts
  });
  if(running||waiting>0)return Object.freeze({
    state:'syncing',label:'SINCRONIZANDO',
    description:waiting>0
      ? `${plural(waiting,'alteração','alterações')} pendente${waiting===1?'':'s'} neste aparelho.`
      : 'Conferindo alterações pendentes…',
    counts
  });
  return Object.freeze({
    state:'synced',label:'SINCRONIZADO',
    description:'Sem alterações pendentes neste aparelho.',
    counts
  });
}
