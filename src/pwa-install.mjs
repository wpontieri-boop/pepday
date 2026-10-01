import { config } from '../config.js';

const INSTALLATION_KEY='pepday.pwa.installation.v1';
const SESSION_LAUNCH_KEY='pepday.pwa.launch-reported.v1';

function safeStorage(storage){
  try{
    const key='__pepday_pwa_test__';
    storage.setItem(key,'1');
    storage.removeItem(key);
    return storage;
  }catch{return null}
}

export function detectPwaPlatform(userAgent=globalThis.navigator?.userAgent||'',platform=globalThis.navigator?.platform||'',maxTouchPoints=globalThis.navigator?.maxTouchPoints||0){
  const ua=String(userAgent);
  const ipadDesktopUa=String(platform)==='MacIntel'&&Number(maxTouchPoints)>1;
  if(/iPad|iPhone|iPod/i.test(ua)||ipadDesktopUa)return 'ios';
  if(/Android/i.test(ua))return 'android';
  if(/Windows|Macintosh|Linux/i.test(ua))return 'desktop';
  return 'other';
}

export function isStandalonePwa(){
  return globalThis.matchMedia?.('(display-mode: standalone)')?.matches===true
    || globalThis.navigator?.standalone===true;
}
function installationId(){
  const storage=safeStorage(globalThis.localStorage);
  if(!storage)return null;
  let value=storage.getItem(INSTALLATION_KEY);
  if(/^[0-9a-f-]{36}$/i.test(value||''))return value;
  value=globalThis.crypto?.randomUUID?.()||null;
  if(!value)return null;
  try{storage.setItem(INSTALLATION_KEY,value)}catch{return null}
  return value;
}

async function reportInstallEvent(eventType){
  const id=installationId();
  const eventId=globalThis.crypto?.randomUUID?.();
  if(!id||!eventId||!config?.supabaseUrl||!config?.supabasePublishableKey)return;
  try{
    await fetch(`${config.supabaseUrl}/rest/v1/rpc/record_pwa_install_event`,{
      method:'POST',
      keepalive:true,
      headers:{
        apikey:config.supabasePublishableKey,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        p_installation_id:id,
        p_event_id:eventId,
        p_event_type:eventType,
        p_platform:detectPwaPlatform()
      })
    });
  }catch(error){
    console.warn('PepDay telemetria PWA adiada:',error?.name||'erro');
  }
}

function showDialog(dialog){
  if(!dialog)return;
  if(typeof dialog.showModal==='function')dialog.showModal();
  else dialog.setAttribute('open','');
}

function closeDialog(dialog){
  if(!dialog)return;
  if(typeof dialog.close==='function'&&dialog.open)dialog.close();
  else dialog.removeAttribute('open');
}

function bootPwaInstall(){
  const button=document.getElementById('installBtn');
  const dialog=document.getElementById('pwaInstallDialog');
  const title=document.getElementById('pwaInstallTitle');
  if(!button)return;

  const platform=detectPwaPlatform();
  let deferredPrompt=null;

  const installed=()=>isStandalonePwa();
  const syncButton=()=>{
    if(installed()){button.classList.add('hidden');return}
    button.classList.toggle('hidden',!(platform==='ios'||deferredPrompt));
  };

  if(platform==='ios'&&title){
    const ipad=/iPad/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    title.textContent=ipad?'Instalar PepDay no iPad':'Instalar PepDay no iPhone';
  }

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredPrompt=event;
    syncButton();
  });

  window.addEventListener('appinstalled',()=>{
    deferredPrompt=null;
    button.classList.add('hidden');
    closeDialog(dialog);
    reportInstallEvent('installed');
  });

  button.addEventListener('click',async()=>{
    if(installed()){syncButton();return}
    if(deferredPrompt){
      const prompt=deferredPrompt;
      deferredPrompt=null;
      await prompt.prompt();
      const choice=await prompt.userChoice.catch(()=>null);
      if(choice?.outcome==='accepted')reportInstallEvent('installed');
      syncButton();
      return;
    }
    if(platform==='ios')showDialog(dialog);
  });

  document.getElementById('pwaInstallClose')?.addEventListener('click',()=>closeDialog(dialog));
  document.getElementById('pwaInstallDone')?.addEventListener('click',()=>closeDialog(dialog));
  dialog?.addEventListener('click',event=>{if(event.target===dialog)closeDialog(dialog)});

  if(installed()){
    const session=safeStorage(globalThis.sessionStorage);
    if(session?.getItem(SESSION_LAUNCH_KEY)!=='1'){
      try{session?.setItem(SESSION_LAUNCH_KEY,'1')}catch{}
      reportInstallEvent('standalone_launch');
    }
  }
  syncButton();
}

if(typeof document!=='undefined')bootPwaInstall();
