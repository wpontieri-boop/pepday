# PepDay — Mapa de URLs e Áreas

Atualização: 05/10/2026.

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

Arquitetura sugerida:
- no **/admin/** haverá um botão/atalho **Parceiros & Afiliados**;
- esse botão abrirá uma área dedicada, sugerida como **/admin/parceiros/**;
- OWNER/ADMIN poderão operar conforme permissões que serão fechadas antes da implementação;
- VIEWER permanece somente leitura;
- o futuro mini painel do próprio parceiro deve ser separado do painel administrativo, em rota própria a definir, por exemplo **/parceiro/**, mostrando apenas dados daquele parceiro.

A rota final do mini painel do parceiro ainda não está fechada e deve ser definida no bloco de especificação antes do Codex.

## Regra de continuidade

Sempre consultar este arquivo junto com `AGENTS.md` e `docs/CURRENT-STATE.md` antes de alterar rotas públicas, landing, app, administração, cartão ou áreas de parceiros.
