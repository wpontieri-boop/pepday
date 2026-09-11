import { normalizeEntitlement } from './entitlement.mjs';

function emit(target,type,detail) {
  const EventConstructor=target?.defaultView?.CustomEvent||globalThis.CustomEvent;
  if(target?.dispatchEvent && EventConstructor) target.dispatchEvent(new EventConstructor(type,{detail}));
}

export function createAccessController(eventTarget=globalThis.document) {
  let access=normalizeEntitlement(null);
  const listeners=new Set();

  function notify() {
    const snapshot=access;
    listeners.forEach(listener=>listener(snapshot));
    // Compatibilidade visual: o evento anuncia o estado, mas nunca é aceito como autoridade.
    emit(eventTarget,'pepday:entitlement',{...snapshot});
  }

  const view=Object.freeze({
    snapshot:()=>access,
    canUsePro:()=>access.pro===true,
    requirePro(context='pro') {
      if(access.pro===true)return true;
      emit(eventTarget,'pepday:pro-required',{context});
      return false;
    },
    subscribe(listener) {
      if(typeof listener!=='function')return ()=>{};
      listeners.add(listener);listener(access);
      return ()=>listeners.delete(listener);
    }
  });

  // Esta capacidade fica somente no módulo de conta e recebe apenas respostas autenticadas da RPC.
  const authority=Object.freeze({
    signedOut(){access=normalizeEntitlement(null);notify()},
    authenticated(raw){access=normalizeEntitlement(raw,{signedIn:true});notify()}
  });

  return Object.freeze({view,authority});
}
