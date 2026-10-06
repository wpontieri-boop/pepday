# PepDay — Mapa de URLs e Áreas

Atualização: 06/10/2026.

## Produção atual

| Área | URL | Função |
|---|---|---|
| Landing pública | https://pepday.com.br/ | Página comercial principal. Apresenta o PepDay e direciona para entrar/usar o app. |
| Aplicativo | https://pepday.com.br/app/ | PepDay PWA: calculadora, rotinas, conta, planos e instalação. A instalação é feita a partir do próprio app/navegador. |
| Administração | https://pepday.com.br/admin/ | Painel interno OWNER/ADMIN/VIEWER. |
| Cartão / QR | https://pepday.com.br/cartao/ | Entrada do cartão físico com benefício de 30 dias PRO. |
| Termos | https://pepday.com.br/termos.html | Termos de Uso. |
| Privacidade | https://pepday.com.br/privacidade.html | Política de Privacidade. |

## Fluxo público recomendado

1. Tráfego orgânico, Instagram, Meta Ads e Google Ads devem apontar preferencialmente para **https://pepday.com.br/**.
2. A landing explica o produto e envia o usuário para **/app/**.
3. O usuário usa o PepDay em **/app/** e, quando desejar, instala o PWA pelo botão/fluxo de instalação do navegador.
4. O cartão físico continua apontando diretamente para **/cartao/** porque tem fluxo comercial próprio.

## Parceiros / Afiliados — arquitetura planejada

Para não aumentar ainda mais o painel administrativo principal, o módulo de Parceiros/Afiliados deve ficar separado visualmente, mas reutilizar a autenticação e as permissões administrativas já aprovadas.

Rotas fechadas para implementação em TEST conforme [PARCEIROS-AFILIADOS.md](PARCEIROS-AFILIADOS.md), ainda não publicadas:
- no **/admin/** haverá um botão/atalho **Parceiros & Afiliados**;
- esse botão abrirá uma área dedicada em **/admin/parceiros/**;
- OWNER/ADMIN poderão operar conforme a matriz da especificação; configuração financeira e repasses ficam com OWNER e step-up;
- VIEWER permanece somente leitura;
- o futuro mini painel do próprio parceiro fica separado em **/parceiro/**, mostrando apenas dados daquele parceiro, na fase P5 posterior.

Links públicos por parceiro: **/cartao/?ref=<slug>**, mais código curto único no fluxo do cartão. Em homologação, usar apenas `homologacao.pepday.com.br`. O admin TEST atual em **/site/admin/** será preservado com aliases canônicos **/admin/** e **/admin/parceiros/** no empacotamento TEST. Nenhuma dessas rotas novas deve ser anunciada como LIVE antes de implementar e verificar o build correspondente.

## Regra de continuidade

Sempre consultar este arquivo junto com `AGENTS.md` e `docs/CURRENT-STATE.md` antes de alterar rotas públicas, landing, app, administração, cartão ou áreas de parceiros.
