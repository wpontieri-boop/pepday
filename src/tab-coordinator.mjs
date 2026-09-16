export function createTabCoordinator({repository,locks=globalThis.navigator?.locks,ownerId=globalThis.crypto?.randomUUID?.(),leaseMs=30000,clock=()=>Date.now(),
  setIntervalFn=setInterval,clearIntervalFn=clearInterval}={}){
  if(!repository||!ownerId)throw new Error('Repository e identificador da aba são obrigatórios.');
  async function fallback(accountScope,work){
    if(!await repository.acquireSyncLeader({ownerId,accountScope,leaseMs,now:clock()}))return {acquired:false};
    const heartbeat=setIntervalFn(()=>repository.acquireSyncLeader({ownerId,accountScope,leaseMs,now:clock()}).catch(()=>{}),Math.max(1000,Math.floor(leaseMs/3)));
    try{return {acquired:true,value:await work()}}finally{clearIntervalFn(heartbeat);await repository.releaseSyncLeader(ownerId,accountScope)}
  }
  return Object.freeze({ownerId,async runExclusive(accountScope,work){
    if(locks?.request)return locks.request(`pepday-sync:${accountScope}`,{mode:'exclusive',ifAvailable:true},lock=>lock?Promise.resolve().then(work).then(value=>({acquired:true,value})):({acquired:false}));
    return fallback(accountScope,work);
  }});
}
