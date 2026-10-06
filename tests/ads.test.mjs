import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adsEligible,shouldShowFreeAd,validAdsensePublicConfig} from '../src/ad-policy.mjs';

test('FREE and expired access can monetize calculator after a result',()=>{
  for(const access of [
    {status:'free',pro:false,signedIn:false,source:'anonymous'},
    {status:'free',pro:false,signedIn:true,source:'account'},
    {status:'pro_expired',pro:false,signedIn:true,source:'trial'},
    {status:'pro_expired',pro:false,signedIn:true,source:'card'}
  ]){
    assert.equal(adsEligible(access),true);
    assert.equal(shouldShowFreeAd(access,{enabled:true,resultVisible:true}),true);
  }
  assert.equal(shouldShowFreeAd({status:'free',pro:false},{enabled:true,resultVisible:false}),false);
  assert.equal(shouldShowFreeAd({status:'free',pro:false},{enabled:false,resultVisible:true}),false);
});

test('Trial, card benefit, courtesy and paid PRO stay ad-free',()=>{
  for(const access of [
    {status:'trial',pro:true,source:'trial'},
    {status:'pro_active',pro:true,source:'card'},
    {status:'pro_active',pro:true,source:'promo'},
    {status:'pro_active',pro:true,source:'mercado_pago'}
  ]){
    assert.equal(adsEligible(access),false);
    assert.equal(shouldShowFreeAd(access,{enabled:true,resultVisible:true}),false);
  }
});

test('AdSense public identifiers are validated before any real request',()=>{
  assert.equal(validAdsensePublicConfig({publisherId:'ca-pub-1234567890123456',slotId:'1234567890'}),true);
  assert.equal(validAdsensePublicConfig({publisherId:'',slotId:''}),false);
  assert.equal(validAdsensePublicConfig({publisherId:'ca-pub-fixture',slotId:'123'}),false);
});

test('homologation previews ads while production remains disabled until approval',async()=>{
  const [testConfig,prodConfig,index,ads]=await Promise.all([
    readFile(new URL('../config.js',import.meta.url),'utf8'),
    readFile(new URL('../config.production.js',import.meta.url),'utf8'),
    readFile(new URL('../index.html',import.meta.url),'utf8'),
    readFile(new URL('../src/ads.mjs',import.meta.url),'utf8')
  ]);
  assert.match(testConfig,/provider:\s*'preview'/);
  assert.match(testConfig,/enabled:\s*true/);
  assert.match(prodConfig,/provider:\s*'adsense'/);
  assert.match(prodConfig,/enabled:\s*false/);
  assert.match(prodConfig,/nonPersonalized:\s*true/);
  assert.match(index,/id="freeAdSlot"/);
  assert.match(index,/src="src\/ads\.mjs"/);
  assert.match(ads,/requestNonPersonalizedAds=1/);
  assert.match(ads,/PepDayAccess\?\.ready/);
  assert.match(ads,/PepDayAccess\?\.snapshot/);
  assert.doesNotMatch(ads,/access=event\.detail/);
  assert.doesNotMatch(index,/pagead2\.googlesyndication\.com/);
});

test('production build publishes the exact AdSense ads.txt authorization',async()=>{
  const [source,build]=await Promise.all([
    readFile(new URL('../ads.txt',import.meta.url),'utf8'),
    readFile(new URL('../scripts/build-public.mjs',import.meta.url),'utf8')
  ]);
  assert.equal(source.trim(),'google.com, pub-9704076016670249, DIRECT, f08c47fec0942fa0');
  assert.match(build,/['"]ads\.txt['"]/);
});
