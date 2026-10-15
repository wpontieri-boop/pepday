# PepDay — pacote ISOLADO de descoberta para AdSense — AINDA NÃO PUBLICAR
Data 15/10/2026. Preparação exclusivamente Git, sem alteração de Render PROD e sem AdSense real.

## Base e objetivo
- Fonte de produção estável: `166de8f56bf4f1c0f2e7ed2ee37a04ec9b0ae4e6` (Render `dep-db4gualg1s2s739d8sn0`, autoDeploy OFF).
- Esta branch `release/adsense-discovery-20261015` parte DESSE commit estável; não é a branch de homologação `v3.0-bloco-b` e não incorpora P3/portal, billing, Auth, administrações, migrações ou mudanças de sincronização posteriores.
- Objetivo: preparar, para promoção FUTURA e SEPARADAMENTE autorizada, a apresentação rastreável da calculadora FREE em navegador, um guia original, canonical de `pepday.com.br`, `robots.txt` e `sitemap.xml`. Não criar anúncios na landing nem exibir Ads reais.

## Escopo byte/SHA256 do build público (comparação com BASE)
- Baseline 94 arquivos; candidato 98 arquivos; **exatamente 6 caminhos alterados/novos**:
  1. `index.html`: link direto e guia, canonical.
  2. `app/app.js`: retorno ao cálculo após tutorial **somente** na entrada alias explícita, preservando Home em `/app/`.
  3. `calculadora/index.html`: alias do MESMO app, servindo JS/CSS/assets de `/app/`, com título/meta de origem.
  4. `guia-calculadora/index.html`: guia explicativo com fórmulas e limites, sem prescrição.
  5. `robots.txt`: regras de rastreamento e ponteiro para sitemap; não confundir com controle de acesso.
  6. `sitemap.xml`: URLs públicas preferenciais, sem rotas privadas.
- **Zero diferença fora dessa allowlist**. No teste anterior, publicar a branch `v3.0-bloco-b` diretamente mudaria **53 caminhos**, incluindo Admin e sincronização: É PROIBIDO usar essa estratégia para a aprovação AdSense.

## Testes/evidências
- 10/10 PASS no pacote isolado: `adsense-public-prep`, `tutorial-alias-entry`, `public-build`, `tutorial-mobile-regression`. Sem reexecutar PASS humanos já registrados.
- `node scripts/build-public.mjs --out <isolado>` PASS. Comparados arquivos por SHA256 com baseline usando builds separados e diretórios temporários; nenhum arquivo extra alterado fora da allowlist. Nenhum segredo, token, transferência, login real ou anúncio carregado.
- Ads seguem DESLIGADOS porque a configuração da produção estável possui `enabled=false`; esta branch não inclui o guard novo completo para ativação futura. **Não habilitar AdSense real a partir deste pacote sem uma avaliação específica do loader, modo PWA e privacidade.**
- Não é aprovação AdSense nem evidência de rastreamento/índice Search Console. Google avalia site, não apenas robots/sitemap; qualidade editorial do conteúdo continua importante.
- TEST oficial continua em `v3.0-bloco-b` e seus PASS anteriores intactos.

## Gate de publicação, sem autorização nesta sessão
1. Proprietário deve autorizar EXPRESSAMENTE a promoção apenas dos seis arquivos públicos de descoberta para `pepday.com.br`, com Ads OFF.
2. Conferir preview/bundle byte-a-byte, rollback e Render service alvo exato; o deploy deve ser explicitamente de commit desta branch isolada, NÃO a ponta de `v3.0-bloco-b`.
3. Publicar com reversibilidade, validar HTTP, hashes, rotas, navegação, tutorial e ausência de mudanças em Admin/mercado pago/Auth/QR/PROD sensível. Confirmar `ads.txt` inalterado.
4. Inspecionar no Search Console e registrar o resultado, enviar sitemap se propriedade confirmada. Revisão AdSense somente com autorização EXPRESSA, após evidências.
