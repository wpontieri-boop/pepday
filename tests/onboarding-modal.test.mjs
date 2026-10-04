import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('onboarding obrigatório usa dialog dedicado após autenticação',async()=>{
  const [html,ui]=await Promise.all([read('index.html'),read('src/account-ui.mjs')]);
  assert.match(html,/<dialog id="accountOnboardingDialog" class="account-onboarding-dialog"[^>]*aria-labelledby="accountProfileTitle"/);
  assert.match(html,/<\/main>\s*<dialog id="accountOnboardingDialog"/);
  assert.ok(html.indexOf('</main>') < html.indexOf('<dialog id="accountOnboardingDialog"'));
  assert.match(html,/id="accountOnboardingIntro"[^>]*>Só falta confirmar estes dados para continuar sua sessão já conectada no PepDay\./);
  assert.match(html,/id="accountSaveProfile"[^>]*>Concluir cadastro e entrar no PepDay<\/button>/);
  assert.match(ui,/if \(complete\) \{[^]*closeOnboardingDialog\(\);[^]*\} else \{[^]*openOnboardingDialog\(\);/);
  assert.match(ui,/if\(dialog&&!dialog\.open\)dialog\.showModal\(\)/);
});

test('onboarding não pode ser descartado por Escape antes dos aceites',async()=>{
  const [ui,account]=await Promise.all([read('src/account-ui.mjs'),read('src/account.mjs')]);
  assert.match(ui,/accountOnboardingDialog'\)\.addEventListener\('cancel',event=>event\.preventDefault\(\)\)/);
  assert.match(ui,/profileLegalCurrent\(next\.profile\)/);
  assert.match(account,/p_adult: true/);
  assert.match(account,/p_sensitive_consent: true/);
});

test('onboarding é central no desktop e praticamente full-screen no mobile',async()=>{
  const css=await read('account.css');
  assert.match(css,/\.account-onboarding-dialog\{width:min\(560px,calc\(100% - 32px\)\)/);
  assert.match(css,/@media\(max-width:620px\)\{[^]*\.account-onboarding-dialog\{width:calc\(100% - 12px\);max-width:none;height:calc\(100dvh - 12px\)/);
  assert.match(css,/\.account-onboarding-dialog \.account-check\{display:flex;align-items:flex-start;gap:10px;width:100%/);
  assert.match(css,/\.account-onboarding-dialog \.account-check input\[type=checkbox\]\{flex:0 0 auto;width:auto/);
  assert.match(css,/\.account-onboarding-dialog \.account-check span\{flex:1 1 auto;min-width:0;overflow-wrap:anywhere/);
  assert.match(css,/safe-area-inset-bottom/);
});

test('convite de push após cadastro permanece sem permissão automática',async()=>{
  const ui=await read('src/account-ui.mjs');
  const submit=ui.slice(ui.indexOf("el('accountProfileForm').addEventListener('submit'"),ui.indexOf('function showProPlans'));
  assert.match(submit,/notificationPermission\(\)==='default'/);
  assert.match(submit,/data-go="home"/);
  assert.match(submit,/pushInvite/);
  assert.doesNotMatch(submit,/Notification\.requestPermission/);
});
