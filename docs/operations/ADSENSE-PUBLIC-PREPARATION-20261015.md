# PepDay — Descoberta pública AdSense preparada, sem deploy de produção

Data: 15/10/2026 (Brasília). Autorização do proprietário: “manda ver” para seguir com a **preparação** do modelo provisório (AdSense futuro somente FREE no navegador; PWA instalado sem anúncios), **não** para promover PROD nem solicitar nova análise Google.

## Continuidade e limite de escopo

- Fonte oficial: `AGENTS.md`, `docs/CURRENT-STATE.md`, `docs/URL-MAP.md`, `docs/operations/ADSENSE-AUDIT-TEST-20261015.md`.
- Branch `v3.0-bloco-b`, base remota `841afb5`. PC CenterPhone `C:\Users\wagne\Documents\PepDay-V3` estava limpo, mas **53 commits atrás** (`cb3b264`); executado `git fetch`, comparação `0/53` e fast-forward `git pull --ff-only` para `841afb5` com árvore limpa. Branch de recuperação P3 e Mac não foram alterados.
- PROD `166de8f` / Render `dep-db4gualg1s2s739d8sn0` permaneceu separado, auto-deploy OFF. `main`/V2.9 preservadas. Não houve ativação real, alteração fiscal, Supabase, Auth ou dados de parceiros.

## Implementado na branch TEST

- `app.js`: ao concluir/pular o tutorial, retorna à calculadora **somente quando** o HTML possui `meta[name="pepday-entry-screen"]` com `content="calculator"`; na rota padrão, o retorno a Home aprovado foi preservado. A tela e as fórmulas não foram reescritas.
- `scripts/prepare-test-discovery.mjs`: alias `/calculadora/` recebe esse indicador e continua `noindex` em TEST; guia existente foi extraído para gerador compartilhado `scripts/discovery-guide.mjs` com o texto original.
- `scripts/build-public.mjs` chama `scripts/prepare-public-discovery.mjs` **apenas quando houver um build de pacote público**: prepara `/` com CTA para `/calculadora/`, guia em `/guia-calculadora/`, base `/app/` para os assets da calculadora, canônicos para `pepday.com.br`, `robots.txt`, `sitemap.xml` e links explicativos. O build público fica **somente preparado no Git** até autorização/deploy separado. Não adiciona script de Ads, não liga `enabled`, não submete URLs ao Search Console/AdSense.
- Testes de publicidade confirmam que PRO/trial/cartão/promo e PWA instalado não recebem publicidade real. O modo FREE navegador permanece **candidato**, condicionado às políticas e aprovação do Google; zero garantia de aprovação. Não afirmar que todo PWA seja universalmente proibido.
- Em Windows, corrigida exclusivamente a leitura CRLF do loader no harness de teste; nenhuma regra do loader foi alterada.

## Validações de 15/10

- **42/42 PASS**, zero falhas, nos testes focados `adsense-audit`, `adsense-public-prep`, `tutorial-alias-entry`, `public-build`, `tutorial-mobile-regression`, `block-b1`, `pwa-install`. Os logs esperados de IndexedDB ausente ocorreram no harness Node, não no navegador real; não marcar como bug de produção nem PASS mobile físico.
- Teste dinâmico da função real `finishTutorial`: rota padrão retorna `home`; alias marcado retorna `calculator`; valor desconhecido retorna `home`.
- `node scripts/build-test.mjs` PASS, rotas `preview/calculadora/` e `preview/guia-calculadora/` geradas; build público PASS via runner isolado (`--out` temporário), sem deploy.
- `git diff --check` e inspeção de escopo PASS; somente 8 arquivos de código/testes no commit `40a9deb`. Nenhum arquivo `.env` ou credencial incluído.
- **TEST LIVE** commit `40a9deb231677780b57d534d9de4af208c6658af`, Render deploy `dep-db8jmqgae00c73a844s0`, `2026-10-15T20:45:46Z`. Inspeção HTTP real **5/5 200**: `/calculadora/` (marker + noindex), `/guia-calculadora/` (conteúdo original + noindex), `/robots.txt`, `/sitemap.xml`, `/app.js` (retorno condicional). HTTP200 não comprova indexação Google, aprovação Ads ou experiência física em celular.
- PROD não recebeu novo deploy. Não repetir PASS HUMANO de calculadora/pagamentos/onboarding já documentados.

## Próxima ação explícita

Conferir visualmente apenas a **entrada nova** `https://homologacao.pepday.com.br/calculadora/` e o **guia novo** `https://homologacao.pepday.com.br/guia-calculadora/` no aparelho/desktop, registrar aprovação ou ajuste. Somente com **autorização expressa adicional** preparar a publicação do build público já pronto em `pepday.com.br`, ainda com Ads OFF; validar domínio, canonical, sitemap, conteúdo e Search Console. Solicitar nova revisão AdSense somente após essa publicação, comprovação e nova autorização do proprietário.
