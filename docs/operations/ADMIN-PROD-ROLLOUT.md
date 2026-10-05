# Promoção administrativa PROD — 04/10/2026

## Escopo autorizado
Promover somente OWNER/ADMIN/VIEWER, senha, TOTP/AAL2 e auditoria homologados em `5f690b8`. Não publicar outras Edge Functions ou alterar regras comerciais.

## Baseline e implantação
- Supabase PROD: `oslefjmwfnddxlotalxu`; TEST preservado.
- Render: `pepday-public`, `srv-davto4tg1s2s73brihf0`, workspace `tea-da7iss0u01pc73d6vflg`, auto-deploy OFF.
- Baseline público confirmado pela API: `898f4fc0f6a608c238bc0959b13b7a2e06748463`, deploy `dep-db1cfk3ncjis73c5i2ig`.
- Comparação dos builds baseline/aprovado: somente `admin/index.html`, `admin/admin.css`, `admin/admin.mjs` diferem. App, landing, cartão, configurações PROD e demais assets são idênticos.
- Pré-condições PROD: exatamente um profile admin, `wpontieri@gmail.com`; nenhuma membership/tabela de auditoria administrativa; nenhum fator TOTP verificado do proprietário. Nenhum usuário/segredo de TEST será copiado.
- Aplicar somente migrations `20261004230000_admin_team_roles_mfa.sql` e `20261004233000_admin_team_fk_indexes.sql`, depois a Edge Function `admin-team-invite` e deploy público manual.
- A função implementa autenticação própria via RPC `get_admin_team`, que exige OWNER+AAL2; manter `verify_jwt=false` conforme artefato homologado.

## Rollback
1. Em falha de frontend, restaurar no Render o deploy `dep-db1cfk3ncjis73c5i2ig` (commit `898f4fc`). Auto-deploy deve continuar OFF.
2. **Rollback seguro padrão:** manter os novos controles AAL2 no banco. O painel anterior ficará indisponível sem MFA; app, landing e cartão permanecem operacionais. Não retirar segurança para recuperar apenas disponibilidade administrativa.
3. Bloquear temporariamente equipe, se necessário, revogando EXECUTE de `get_admin_team`, `admin_set_team_member`, `admin_disable_team_member` para `authenticated`; isto também bloqueia a Edge Function antes de qualquer criação de usuário. Preservar tabelas, membros, fatores e logs para investigação.
4. Preferir correção e nova publicação do painel aprovado. Reverter wrappers para funções `_legacy` reabriria o acesso anterior sem MFA: não executar automaticamente. Não apagar tabelas/auditoria, não copiar senhas/TOTP e não rebaixar usuários.
5. As migrations são transacionais; falha antes do commit não aplica DDL parcial. Após sucesso, não reaplicar a mesma migration.

## Ativação humana específica de PROD
O OWNER deverá usar “Configurar primeiro acesso” em `https://pepday.com.br/admin/`, validar seu e-mail e configurar senha + autenticador nesse ambiente. É ativação de PROD, não repetição do QA homologado. O OWNER pode adicionar membros em PROD; não importar contas ou fatores de TEST.
