# Admin TOTP — correção UX, 09/10/2026

Escopo autorizado: saída/reinício da tentativa de login Admin na etapa TOTP. Implementação primeiro em TEST; promoção PROD exige nova autorização com os resultados desta entrega. Baseline 9ac4b9a (PROD funcional 5f0a678).

## Causa e comportamento

A etapa TOTP escondia o login e oferecia somente Confirmar 2FA. Não havia saída clara para trocar e-mail. Isso explica a UX presa, sem provar a causa do código inválido no Edge. Chrome PROD tem PASS humano registrado de logout + novo login com senha/TOTP.

Agora a conta é identificada na tela. Voltar e Sair invalidam a tentativa, abortam requisições Auth pendentes, aguardam sua conclusão e fazem signOut local. Respostas antigas não abrem o dashboard. Os campos são limpos; somente a chave `pepday-${environment}-${projectRef}-admin-auth` e sufixos `-code-verifier`/`-user` são removidos, em localStorage/sessionStorage. Logout remoto tem timeout de dez segundos; se falhar, a UI informa que a remoção local foi concluída, mas não promete revogação no servidor. Tokens de acesso já emitidos continuam sujeitos às regras existentes de validade/guards.

Refresh AAL1 retoma TOTP. Uma entrada sem dados sensíveis no histórico permite Voltar do navegador encerrar a tentativa; avançar não restaura a sessão cancelada. AAL2 já válido continua abrindo o painel como antes. O fator existente, OWNER, senha, backend, sessão máxima, permissões e auditoria não mudam. Não há bypass MFA.

## Testes reproduzíveis

- `node --check site/admin/admin.mjs` e `node --check scripts/test-admin-totp-ui.mjs`: PASS.
- `npm run build:test` e `npm run build:public`: PASS; build público não publicado.
- `node --test tests/admin-team-access.test.mjs tests/admin-dashboard.test.mjs tests/block-c-admin-metrics.test.mjs`: 20/20 PASS.
- `npm test`: 472/472 PASS, zero falhas/skip.
- Runner `node scripts/test-admin-totp-ui.mjs`, com variáveis `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, `EDGE_EXECUTABLE` apontando para runtime/instalações locais: oito matrizes PASS. Opcional `ADMIN_TOTP_BROWSER=Chrome` ou `Edge` limita o navegador.

Runner usa Chrome e Edge reais com perfis temporários isolados, SDK Supabase 2.116.0 do repositório e interceptação de todas as requisições. Configurações TEST/PROD são lidas separadamente; Auth/RPC são sintéticos. Não usa credencial real, não envia login/e-mail nem cria/altera/remove fator, usuário ou dado remoto. Não equivale a validação humana em PROD.

Cada matriz cobre senha→TOTP, código inválido/retry, refresh, back/forward, troca de e-mail/fator sintético correspondente, saída local, confirmação válida liberando somente AAL2, refresh AAL2, saída do dashboard, verificação pendente cancelada antes de responder, falha remota de logout e preservação de armazenamento cliente/outro ambiente. Viewports 390×844 e 1280×900: sem overflow/erro JS; contraste/foco dos botões revisados visualmente no Edge mobile. Screenshot/logs ficam ignorados em test-output.

Comparação dos pacotes públicos de 9ac4b9a e desta correção, normalizando exclusivamente finais de linha Windows/Unix: somente `admin/index.html`, `admin/admin.mjs` e `admin/admin.css` mudam. Nenhum arquivo de parceiros, billing, recovery, cartão, landing ou app cliente muda funcionalmente.

## Promoção preparada, ainda não autorizada

Após confirmar TEST LIVE e hashes, pedir autorização da promoção pequena dos três artefatos Admin. PROD permanece 5f0a678 / dep-db42cpk9v7es738s3hn0, auto-deploy OFF. Não há migration/configuração/secreto para aplicar. Rollback frontend é o commit funcional PROD anterior; não resetar fator, alterar senha ou enfraquecer guardas. A publicação futura deve conferir o pacote e smoke somente desta tela. Nenhum QA humano antigo deve ser repetido.
