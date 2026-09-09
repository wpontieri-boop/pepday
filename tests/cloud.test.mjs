import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validatePublicConfig,initializeCloud,readPublicAuthSettings,accountError,loadAccountState } from '../src/cloud.mjs';
import { createAccountService } from '../src/account.mjs';
const config={environment:'test',projectRef:'fixture',supabaseUrl:'https://fixture.supabase.co',
  supabasePublishableKey:'sb_publishable_fixture',blockedProductionUrl:'https://example.test/pepday/',
  authRedirectUrl:null,allowedRedirects:[]};
test('chave pública aceita; key elevada e projeto divergente rejeitados',()=>{
  assert.equal(validatePublicConfig(config,'https://stage.test/'),true);
  assert.throws(()=>validatePublicConfig({...config,supabasePublishableKey:'sb_secret_forbidden'},'https://stage.test/'));
  assert.throws(()=>validatePublicConfig({...config,supabaseUrl:'https://other.supabase.co'},'https://stage.test/'));
});
test('homologação bloqueada no caminho de produção e em file://',()=>{
  for(const url of ['https://example.test/pepday/','https://example.test/pepday/index.html','https://example.test/pepday','file:///test/index.html']){
    assert.throws(()=>validatePublicConfig(config,url));
  }
  assert.equal(validatePublicConfig(config,'https://example.test/pepday-test/'),true);
});
test('SDK recebe chave pública e armazenamento exclusivo do projeto de testes',()=>{
  let args;
  initializeCloud((...values)=>{args=values;return {};},config,'https://stage.test/');
  assert.equal(args[1],'sb_publishable_fixture');
  assert.equal(args[2].auth.storageKey,'pepday-test-fixture-auth');
  assert.equal(args[2].auth.flowType,'pkce');
});
test('OTP funciona sem endereço de retorno; Google permanece bloqueado',async()=>{
  let sent;
  const svc=createAccountService({auth:{signInWithOtp:async p=>{sent=p;return {data:{}};}}});
  await svc.email('tester@example.invalid');
  assert.equal(sent.options.emailRedirectTo,undefined);
  assert.throws(()=>svc.google(),/endereço de retorno/);
});
test('configuração de métodos usa apenas apikey e não cacheia',async()=>{
  let request;
  const result=await readPublicAuthSettings(config,async(url,options)=>{
    request=options;return {ok:true,json:async()=>({external:{email:true,google:false}})};
  });
  assert.deepEqual(result,{email:true,google:false});
  assert.equal(request.cache,'no-store');
  assert.deepEqual(request.headers,{apikey:config.supabasePublishableKey});
});
test('mensagens de erro não expõem payload, token ou detalhes internos',()=>{
  assert.match(accountError({code:'PGRST205',message:'secret payload'}),/preparação do banco/);
  assert.doesNotMatch(accountError({message:'secret payload'}),/secret/);
  assert.match(accountError({code:'otp_expired'}),/expirou/);
});
test('sessão inexistente não lê perfil nem status comercial',async()=>{
  const state=await loadAccountState({auth:{getUser:async()=>({error:{name:'AuthSessionMissingError'}})}},{});
  assert.equal(state.status,'signed_out');
});
test('service worker deixa Auth, queries e requisições privadas fora do cache',()=>{
  const listeners={}, intercepted=[];
  const scope='https://stage.test/pepday/';
  const context={URL,Set,Request,self:{registration:{scope},addEventListener:(type,fn)=>{listeners[type]=fn;}},
    caches:{open:async()=>({match:async()=>new Response('cached')})},fetch:async()=>new Response('network'),Response};
  vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),context);
  for(const url of ['https://fixture.supabase.co/auth/v1/token',scope+'index.html?code=private',scope+'other.json']){
    listeners.fetch({request:new Request(url),respondWith:p=>intercepted.push(p)});
  }
  listeners.fetch({request:new Request(scope+'app.js',{headers:{Authorization:'Bearer fixture'}}),respondWith:p=>intercepted.push(p)});
  assert.equal(intercepted.length,0);
  listeners.fetch({request:new Request(scope+'app.js'),respondWith:p=>intercepted.push(p)});
  assert.equal(intercepted.length,1);
});
