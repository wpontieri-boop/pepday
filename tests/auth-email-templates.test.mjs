import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('Auth email templates use 6-digit OTP token instead of confirmation links', async () => {
  const [config, confirmation, magicLink] = await Promise.all([
    readFile(new URL('supabase/config.toml', root), 'utf8'),
    readFile(new URL('supabase/templates/confirmation.html', root), 'utf8'),
    readFile(new URL('supabase/templates/magic_link.html', root), 'utf8'),
  ]);

  assert.match(config, /\[auth\.email\.template\.confirmation\]/);
  assert.match(config, /Seu código de confirmação PepDay: \{\{ \.Token \}\}/);
  assert.match(config, /\.\/supabase\/templates\/confirmation\.html/);
  assert.match(config, /\[auth\.email\.template\.magic_link\]/);
  assert.match(config, /Seu código de acesso PepDay: \{\{ \.Token \}\}/);
  assert.match(config, /\.\/supabase\/templates\/magic_link\.html/);

  for (const template of [confirmation, magicLink]) {
    assert.match(template, /\{\{ \.Token \}\}/);
    assert.doesNotMatch(template, /ConfirmationURL|TokenHash/);
  }
});
