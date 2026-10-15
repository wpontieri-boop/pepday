export function adsEligible(access){
  return access?.pro!==true;
}

export function shouldShowFreeAd(access,{resultVisible=true,enabled=true}={}){
  return enabled===true && resultVisible===true && adsEligible(access);
}

export function validAdsensePublicConfig({publisherId='',slotId=''}={}){
  return /^ca-pub-\d+$/.test(publisherId) && /^\d+$/.test(slotId);
}

// Conservative product gate, not a claim of Google approval for any viewing frame.
export function realAdsAllowed({enabled=false,online=false,installed=false,embedded=true,calculatorActive=false}={}){
  return enabled===true && online===true && installed===false && embedded===false && calculatorActive===true;
}
