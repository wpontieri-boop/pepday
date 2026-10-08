import {config} from '../config.js';
import {referralAction,readReferralToken} from './partner-referral.mjs';
import {isPartnerEnvironment,createPartnerCardClient} from './partner-environment.mjs';
import {readPartnerLock,lockedMessage} from './partner-lock.mjs';
export function isPartnerTest(config,location){
  return config.environment==='test'&&config.projectRef==='fsbqpyyprtymwrmzsacp'&&location.hostname==='homologacao.pepday.com.br';
}
export async function publicPartnerSearch(query='',ref='',{fetcher=fetch}={}){
  const res=await fetcher(config.supabaseUrl+'/functions/v1/partner-public',{
    method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({query,ref})
  });
  if(!res.ok)throw new Error('Busca temporariamente indisponível.');
  return res.json();
}
if(typeof document!=='undefined'&&isPartnerEnvironment(config,globalThis.location)){
  const panel=document.getElementById('partnerSearch');
  if(panel){
    const input=document.getElementById('partnerQuery'),results=document.getElementById('partnerResults'),status=document.getElementById('partnerSearchStatus');
    let timer,sequence=0,busy=false,pending=null,referralEnabled=false,locked=false,checking=true,checkSequence=0;
    let refreshing=false,refreshQueued=false,refHandled=false;
    const choices=document.getElementById('partnerChoices'),cta=document.getElementById('openPepDay');
    const client=createPartnerCardClient(globalThis.supabase.createClient,config,location);
    const ref=new URL(globalThis.location.href).searchParams.get('ref')||'';
    const controls=()=>{
      choices.hidden=locked||checking||!referralEnabled;
      choices.querySelectorAll('button,input').forEach(el=>el.disabled=locked||checking||busy);
    };
    const origin=document.getElementById('partnerOrigin'),dialog=document.getElementById('partnerSwap');
    const chosen=data=>{origin.textContent=data.partner?`Você veio por ${[data.partner.public_name,data.partner.city,data.partner.description].filter(Boolean).join(' · ')}.`:'Você pode continuar sem indicação.';results.replaceChildren()};
    const checkLock=async()=>{
      const current=++checkSequence;checking=true;controls();clearTimeout(timer);++sequence;
      if(dialog.open){dialog.close();pending=null}
      try{
        const data=await readPartnerLock(client);
        if(current!==checkSequence)return false;
        locked=data.partner_locked;checking=false;
        if(locked){
          results.replaceChildren();
          panel.hidden=false;
          origin.textContent=data.partner?`Indicação confirmada: ${[data.partner.public_name,data.partner.city,data.partner.description].filter(Boolean).join(' · ')}.`:'Sem indicação — escolha definitiva.';
          status.textContent=lockedMessage(data,!!ref);cta.textContent='Abrir PepDay';
        }
        controls();return !locked;
      }catch{
        if(current===checkSequence){panel.hidden=false;origin.textContent='Confira sua indicação na conta.';status.textContent='Não foi possível conferir sua indicação. Atualize a página ou abra o PepDay.';controls()}
        return false;
      }
    };
    const mutate=async(action,options={})=>{
      if(busy||locked||checking)return;busy=true;controls();
      // Recheck before every action, including clear, after activation in another tab.
      if(!await checkLock()){busy=false;controls();return}
      const current=checkSequence;
      const hadPrevious=!!readReferralToken();
      try{
        const data=await referralAction(action,options);
        if(current!==checkSequence||locked||checking)return;
        referralEnabled=data.enabled===true;panel.hidden=!referralEnabled;
        if(data.code==='CONFIRM_SWAP_REQUIRED'){
          pending=options;document.getElementById('partnerSwapText').textContent=`Trocar a indicação recebida por link ou código para ${data.partner.public_name} · ${data.partner.city}?`;dialog.showModal();
        }else if(data.code==='LOCAL_SELECTION_CHANGED'){status.textContent='A indicação mudou em outra aba. Atualize esta página antes de continuar.'}
        else if(data.partner){chosen(data);status.textContent='Indicação guardada neste navegador. O vínculo será fechado ao liberar os 30 dias PRO.'}
        else if(['CLEARED','INTENT_UNAVAILABLE','INTENT_EXPIRED_OR_MISSING'].includes(data.code)){chosen(data);status.textContent=data.code==='CLEARED'?'Escolha sem indicação confirmada.':hadPrevious?'A indicação anterior não está disponível. Seu benefício continua válido.':''}
        else {status.textContent='Indicação não encontrada ou indisponível. Sua escolha anterior, se houver, foi mantida. Você pode continuar sem indicação.'}
      }catch(e){status.textContent=e.message||'Indicação indisponível. Você pode continuar normalmente.'}
      finally{busy=false;controls();if(refreshQueued&&!refreshing){refreshQueued=false;setTimeout(()=>refresh(),0)}}
    };
    document.getElementById('openPepDay').addEventListener('click',e=>{if(busy){e.preventDefault();status.textContent='Aguarde a confirmação da indicação.'}});
    document.getElementById('partnerNoReferral').addEventListener('click',()=>mutate('clear'));
    document.getElementById('partnerSwapConfirm').addEventListener('click',()=>{dialog.close();const options=pending;pending=null;mutate('intent',{...options,confirmSwap:true})});
    document.getElementById('partnerSwapCancel').addEventListener('click',()=>{pending=null;dialog.close();status.textContent='Indicação anterior mantida.'});
    const show=async(query='',ref='')=>{
      if(locked||checking||busy)return;
      const current=++sequence;
      try{
        const data=await publicPartnerSearch(query,ref);
        if(current!==sequence||locked||checking)return;
        panel.hidden=!data.enabled||!referralEnabled;
        results.replaceChildren();
        for(const p of data.partners||[]){
          const li=document.createElement('li'),button=document.createElement('button');
          button.type='button';button.textContent=[p.public_name,p.city,p.description].filter(Boolean).join(' · ');
          button.addEventListener('click',()=>mutate('intent',{ref:p.slug,source:'manual'}));
          li.append(button);results.append(li);
        }
        status.textContent=ref&&!data.partners?.length?'Código não encontrado. Você pode continuar sem indicação.':query&&!data.partners?.length?'Nenhum parceiro encontrado.':'';
      }catch{if(current===sequence){results.replaceChildren();status.textContent='Busca indisponível. Você pode continuar normalmente.'}}
    };
    input.addEventListener('input',()=>{if(locked||checking||busy)return;clearTimeout(timer);++sequence;results.replaceChildren();timer=setTimeout(()=>{if(input.value.trim().length>=2)show(input.value.trim());else status.textContent='Digite pelo menos 2 caracteres.'},300)});
    document.getElementById('partnerCodeForm').addEventListener('submit',e=>{e.preventDefault();clearTimeout(timer);mutate('intent',{ref:document.getElementById('partnerCode').value.trim(),source:'code',eventId:crypto.randomUUID()})});
    // Inspect persisted state first so a failed replacement still displays the prior choice.
    const refresh=async()=>{
      if(busy||refreshing){refreshQueued=true;return}
      refreshing=true;
      try{
        origin.textContent='Conferindo sua indicação…';status.textContent='';
        if(!await checkLock())return;
        cta.textContent='Criar conta e liberar 30 dias PRO';
        await mutate('inspect');
        // Returning focus must not replay an old URL over a later manual/code choice.
        if(ref&&referralEnabled&&!refHandled){refHandled=true;await mutate('intent',{ref,source:'link',eventId:crypto.randomUUID()})}
        else if(referralEnabled&&!readReferralToken())await show();
      }finally{refreshing=false;if(refreshQueued){refreshQueued=false;setTimeout(()=>refresh(),0)}}
    };
    // Do not call Auth methods from inside its synchronous callback (SDK lock).
    client.auth.onAuthStateChange(event=>{if(['SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event))setTimeout(()=>refresh(),0)});
    window.addEventListener('focus',()=>refresh());
    refresh();
  }
}
