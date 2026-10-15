import {config} from '../config.js';
import {shouldShowFreeAd,validAdsensePublicConfig,realAdsAllowed} from './ad-policy.mjs?v=2';

const slot=document.getElementById('freeAdSlot');
const mount=document.getElementById('freeAdMount');
const result=document.getElementById('result');
const calculator=document.getElementById('calculator');

function realContextAllowed(){
  const installed=navigator.standalone===true||['standalone','fullscreen','minimal-ui','window-controls-overlay'].some(mode=>globalThis.matchMedia?.(`(display-mode: ${mode})`).matches);
  const embedded=globalThis.top!==globalThis.self||/^android-app:/i.test(document.referrer)||/; wv\)|\bWebView\b/i.test(navigator.userAgent);
  return realAdsAllowed({enabled:config.ads?.enabled,online:navigator.onLine,installed,embedded,calculatorActive:calculator?.classList.contains('active')===true});
}

function eligibleNow(){
  return accessReady&&shouldShowFreeAd(access,{enabled:config.ads?.enabled===true,resultVisible:resultVisible()})&&
    calculator?.classList.contains('active')===true&&
    (config.ads?.provider==='preview'||(config.ads?.provider==='adsense'&&validAdsenseConfig()&&realContextAllowed()));
}

let access=globalThis.PepDayAccess?.snapshot?.()||{pro:false};
let accessReady=globalThis.PepDayAccess?.ready?.()===true;
let rendered=false;
let scriptPromise=null;

function validAdsenseConfig(){
  return validAdsensePublicConfig(config.ads);
}

function ensureAdsenseScript(){
  if(scriptPromise)return scriptPromise;
  scriptPromise=new Promise((resolve,reject)=>{
    if(document.querySelector('script[data-pepday-adsense]')){resolve();return}
    globalThis.adsbygoogle=globalThis.adsbygoogle||[];
    if(config.ads?.nonPersonalized!==false)globalThis.adsbygoogle.requestNonPersonalizedAds=1;
    const script=document.createElement('script');
    script.async=true;
    script.crossOrigin='anonymous';
    script.dataset.pepdayAdsense='true';
    script.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='+encodeURIComponent(config.ads.publisherId);
    script.onload=()=>resolve();
    script.onerror=()=>reject(new Error('ADSENSE_SCRIPT_FAILED'));
    document.head.append(script);
  });
  return scriptPromise;
}

function renderPreview(){
  if(rendered)return;
  const preview=document.createElement('div');
  preview.className='free-ad-preview';
  preview.innerHTML='<strong>Espaço publicitário</strong><span>Prévia de homologação · somente PepDay FREE</span>';
  mount.replaceChildren(preview);
  rendered=true;
}

async function renderAdsense(){
  if(rendered||!validAdsenseConfig()||!eligibleNow())return;
  const ad=document.createElement('ins');
  ad.className='adsbygoogle';
  ad.style.display='block';
  ad.dataset.adClient=config.ads.publisherId;
  ad.dataset.adSlot=config.ads.slotId;
  ad.dataset.adFormat='auto';
  ad.dataset.fullWidthResponsive='true';
  mount.replaceChildren(ad);
  rendered=true;
  await ensureAdsenseScript();
  // Entitlement, page visibility or display mode may change during script loading.
  if(!eligibleNow()){slot.classList.add('hidden');mount.replaceChildren();rendered=false;return}
  (globalThis.adsbygoogle=globalThis.adsbygoogle||[]).push({});
}

function resultVisible(){
  return Boolean(result&&!result.classList.contains('hidden'));
}

async function refreshAdVisibility(){
  if(!slot||!mount)return;
  const show=eligibleNow();
  slot.classList.toggle('hidden',!show);
  slot.dataset.adState=show?'visible':'hidden';
  if(!show)return;
  if(config.ads?.provider==='preview'){renderPreview();return}
  if(config.ads?.provider==='adsense')await renderAdsense().catch(()=>{slot.classList.add('hidden');slot.dataset.adState='error'});
}

document.addEventListener('pepday:entitlement',()=>{
  access=globalThis.PepDayAccess?.snapshot?.()||{pro:false};
  accessReady=globalThis.PepDayAccess?.ready?.()===true;
  void refreshAdVisibility();
});

if(result){
  new MutationObserver(()=>void refreshAdVisibility()).observe(result,{attributes:true,attributeFilter:['class']});
}
if(calculator)new MutationObserver(()=>void refreshAdVisibility()).observe(calculator,{attributes:true,attributeFilter:['class']});
for(const mode of ['standalone','fullscreen','minimal-ui','window-controls-overlay'])globalThis.matchMedia?.(`(display-mode: ${mode})`).addEventListener?.('change',()=>void refreshAdVisibility());
globalThis.addEventListener('online',()=>void refreshAdVisibility());
globalThis.addEventListener('offline',()=>void refreshAdVisibility());

void refreshAdVisibility();
