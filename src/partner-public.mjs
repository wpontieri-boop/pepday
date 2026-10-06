import {config} from '../config.js';
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
if(typeof document!=='undefined'&&isPartnerTest(config,globalThis.location)){
  const panel=document.getElementById('partnerSearch');
  if(panel){
    const input=document.getElementById('partnerQuery'),results=document.getElementById('partnerResults'),status=document.getElementById('partnerSearchStatus');
    let timer,sequence=0;
    const show=async(query='',ref='')=>{
      const current=++sequence;
      try{
        const data=await publicPartnerSearch(query,ref);
        if(current!==sequence)return;
        panel.hidden=!data.enabled;
        results.replaceChildren();
        for(const p of data.partners||[]){
          const li=document.createElement('li'),button=document.createElement('button');
          button.type='button';button.textContent=[p.public_name,p.city,p.description].filter(Boolean).join(' · ');
          button.addEventListener('click',()=>{status.textContent=`Selecionado para conferência: ${p.public_name}. A seleção ainda não é vinculada à sua conta nesta prévia.`;results.replaceChildren()});
          li.append(button);results.append(li);
        }
        status.textContent=ref&&!data.partners?.length?'Código não encontrado. Você pode continuar sem indicação.':query&&!data.partners?.length?'Nenhum parceiro encontrado.':'';
      }catch{if(current===sequence){results.replaceChildren();status.textContent='Busca indisponível. Você pode continuar normalmente.'}}
    };
    input.addEventListener('input',()=>{clearTimeout(timer);++sequence;results.replaceChildren();timer=setTimeout(()=>{if(input.value.trim().length>=2)show(input.value.trim());else status.textContent='Digite pelo menos 2 caracteres.'},300)});
    document.getElementById('partnerCodeForm').addEventListener('submit',e=>{e.preventDefault();clearTimeout(timer);show('',document.getElementById('partnerCode').value.trim())});
    show('',new URL(globalThis.location.href).searchParams.get('ref')||'');
  }
}
