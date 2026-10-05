export function adsEligible(access){
  return access?.pro!==true;
}

export function shouldShowFreeAd(access,{resultVisible=true,enabled=true}={}){
  return enabled===true && resultVisible===true && adsEligible(access);
}

export function validAdsensePublicConfig({publisherId='',slotId=''}={}){
  return /^ca-pub-\d+$/.test(publisherId) && /^\d+$/.test(slotId);
}
