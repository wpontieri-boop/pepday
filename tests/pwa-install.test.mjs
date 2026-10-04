import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectIosBrowser, detectPwaPlatform } from '../src/pwa-install.mjs';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');

test('detecção de plataforma cobre Android, iPhone e iPadOS com UA desktop',()=>{
  assert.equal(detectPwaPlatform('Mozilla/5.0 (Linux; Android 15)','Linux armv8l',5),'android');
  assert.equal(detectPwaPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)','iPhone',5),'ios');
  assert.equal(detectPwaPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)','MacIntel',5),'ios');
  assert.equal(detectPwaPlatform('Mozilla/5.0 (Windows NT 10.0)','Win32',0),'desktop');
});

test('UX PWA usa prompt nativo Android e guia iOS sem auto-instalação',async()=>{
  const [html,source]=await Promise.all([read('index.html'),read('src/pwa-install.mjs')]);
  assert.match(html,/id="installBtn"[^>]*>Instalar PepDay</);
  assert.match(html,/Mantenha esta tela aberta/);
  assert.match(html,/Não precisa trocar de navegador/);
  assert.match(html,/Fechar instruções/);
  assert.match(html,/Adicionar à Tela de Início/);
  assert.match(html,/id="pwaInstallDialog"/);
  assert.match(html,/src="src\/pwa-install\.mjs\?v=23"/);
  assert.match(source,/beforeinstallprompt/);
  assert.match(source,/prompt\.prompt\(\)/);
  assert.match(source,/navigator\?\.standalone/);
  assert.match(source,/display-mode: standalone/);
  assert.match(source,/appinstalled/);
});

test('guia iOS diferencia Chrome e Safari com passos reais observados no aparelho',()=>{
  const chrome='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.0.0 Mobile/15E148 Safari/604.1';
  const safari='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  assert.equal(detectIosBrowser(chrome),'chrome');
  assert.equal(detectIosBrowser(safari),'safari');
});
test('telemetria PWA envia somente identificador anônimo, evento e plataforma',async()=>{
  const source=await read('src/pwa-install.mjs');
  assert.match(source,/pepday\.pwa\.installation\.v1/);
  assert.match(source,/record_pwa_install_event/);
  assert.match(source,/p_installation_id/);
  assert.match(source,/p_event_type/);
  assert.match(source,/p_platform/);
  assert.doesNotMatch(source,/email|routine|vial|health|name:/i);
});

test('migration PWA bloqueia leitura direta e expõe apenas RPCs controladas',async()=>{
  const sql=await read('supabase/migrations/20261001175011_pwa_install_telemetry.sql');
  assert.match(sql,/create table if not exists public\.pwa_install_events/i);
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on table public\.pwa_install_events\s+from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.record_pwa_install_event\(uuid,uuid,text,text\)\s+to anon,authenticated/i);
  assert.match(sql,/where id=u and role='admin'/);
  assert.match(sql,/grant execute on function public\.get_admin_pwa_metrics\(integer\)\s+to authenticated/i);
  assert.doesNotMatch(sql,/\buser_id\b|\bemail\b|\broutine\b|\bvial\b/i);
});
test('painel admin mostra adoção PWA e consulta RPC agregada',async()=>{
  const [html,source]=await Promise.all([
    read('site/admin/index.html'),
    read('site/admin/admin.mjs')
  ]);
  for(const text of ['INSTALAÇÕES DETECTADAS','DISPOSITIVOS ATIVOS','ABERTURAS INSTALADAS']){
    assert.match(html,new RegExp(text));
  }
  assert.match(source,/get_admin_pwa_metrics/);
  assert.match(source,/data\?\.detected_installs/);
  assert.match(source,/data\?\.active_installed_devices/);
  assert.match(source,/data\?\.standalone_launches/);
});

test('service worker atual inclui módulo de instalação e novo cache',async()=>{
  const sw=await read('sw.js');
  assert.match(sw,/pepday-v3-profile-sync-25/);
  assert.match(sw,/\.\/src\/pwa-install\.mjs/);
});
