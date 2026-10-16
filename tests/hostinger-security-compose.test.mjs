import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../infra/hostinger-security-test/compose.yaml', import.meta.url), 'utf8');

test('Hostinger TEST usa projeto e container isolados do PepDay', () => {
  assert.match(source, /^name: pepday-security-test$/m);
  assert.match(source, /^  clamav:$/m);
  assert.match(source, /^    container_name: pepday-clamav-test$/m);
  assert.match(source, /^  pepday_security:$/m);
  assert.doesNotMatch(source, /central_ia_|central-postgres|central-hermes|central-scec|central-telegram/i);
});

test('imagem oficial fixada em versão e digest exatos para revisão', () => {
  assert.match(source, /^    image: clamav\/clamav:1\.5\.4@sha256:[a-f0-9]{64}$/m);
  assert.doesNotMatch(source, /clamav\/(?:clamav):(?:latest|stable)(?:\s|$)/m);
});

test('nada publica portas, monta o host ou acessa rede do host', () => {
  assert.doesNotMatch(source, /^\s*(?:ports|expose|network_mode|privileged|pid|ipc|devices):/m);
  assert.doesNotMatch(source, /\/var\/run\/docker\.sock|\/etc\/|\/opt\/|\/srv\/|\/home\/|host\.docker\.internal/);
  assert.match(source, /^      - clamav_signatures:\/var\/lib\/clamav$/m);
  assert.match(source, /^    driver: bridge$/m);
});

test('cotas de CPU, memória, processos e proteção básica configuradas', () => {
  assert.match(source, /^    cpus: 0\.75$/m);
  assert.match(source, /^    mem_limit: 4g$/m);
  assert.match(source, /^    memswap_limit: 4g$/m);
  assert.match(source, /^    pids_limit: 128$/m);
  assert.match(source, /^      - no-new-privileges:true$/m);
  assert.match(source, /^      - ALL$/m);
});

test('somente volume exclusivo para as assinaturas, sem banco ou backup montado', () => {
  assert.match(source, /^volumes:\n  clamav_signatures:\s*$/m);
  assert.doesNotMatch(source, /^\s*(?:postgres|database|backup|secrets|env_file|environment):/m);
});

test('logs limitados e nenhum serviço de envio/exportação automático', () => {
  assert.match(source, /^        max-size: "5m"$/m);
  assert.match(source, /^        max-file: "2"$/m);
  assert.doesNotMatch(source, /\b(?:cron|schedule|webhook|telegram|whatsapp|billing|adserver)\b/i);
});
