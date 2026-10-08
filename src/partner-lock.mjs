// No attribution state is trusted from storage; the RPC scopes its read to auth.uid().
export async function readPartnerLock(client){
  const identity=await client.auth.getUser();
  if(identity.error){
    if(identity.error.name==='AuthSessionMissingError')return {partner_locked:false,partner:null};
    throw new Error('Não foi possível conferir sua indicação. Atualize a página ou abra o PepDay.');
  }
  if(!identity.data?.user)return {partner_locked:false,partner:null};
  const {data,error}=await client.rpc('get_my_partner_attribution').abortSignal(AbortSignal.timeout(10000));
  if(error||typeof data?.partner_locked!=='boolean')throw new Error('Não foi possível conferir sua indicação. Atualize a página ou abra o PepDay.');
  const p=data.partner;
  return {partner_locked:data.partner_locked,partner:data.partner_locked&&p?{
    public_name:String(p.public_name||''),city:String(p.city||''),description:String(p.description||'')
  }:null};
}

export function lockedMessage(data,hasRef=false){
  const message=data.partner
    ?`Sua indicação já foi confirmada com ${data.partner.public_name} e não pode ser alterada após a ativação do benefício.`
    :'Seu benefício já foi ativado sem indicação e essa escolha não pode mais ser alterada.';
  return message+(hasRef?' A referência deste link foi ignorada; sua escolha definitiva foi mantida.':'');
}
