# Parceiros / Afiliados — P1 TEST

Implementação em 06/10/2026. Escopo aprovado: [especificação](../PARCEIROS-AFILIADOS.md), fase P1. Não existe atribuição persistida, comissão gerada, pagamento, convite, portal ou Admin PWA novo nesta fase.

## Ambiente e implantação

- Branch `v3.0-bloco-b`; base limpa/fetch em `4793e1adb170fe9a87cd62a2b6fcba50816d0bd1`, divergência 0/0.
- Supabase TEST `fsbqpyyprtymwrmzsacp`. Migration local/remota `20261006213126_partners_p1_test.sql` / `partners_p1_test`; timestamp local alinhado ao registrado pelo MCP. Não reaplicar.
- Seis tabelas privadas com RLS e sem grants diretos; cinco RPCs administrativas autenticadas e uma busca restrita a service_role. Todas usam search_path fixo. Helpers não são públicos.
- Edge TEST `partner-public`, ID `aa7f220e-8fa1-48f0-a8e1-8702596e587f`, v2 ACTIVE; SHA256 do pacote `5131afd69db8ca1e796b2fdab0728f41198d5829202b7b7c57ed6ca73a4fc711`.
- Endpoint anônimo solicitado para busca pública: `https://fsbqpyyprtymwrmzsacp.supabase.co/functions/v1/partner-public`. verify_jwt=false intencional; leitura pública limitada, origem homologação, URL TEST exata, projeção mínima, POST/OPTIONS, corpo até 512 bytes, consulta até 80 caracteres, até 10 resultados e quota global 120/minuto. Sem dados privados ou coleta de IP. Sem origem é permitido para consultas públicas; CORS não é autenticação. Quota global protege o banco, mas pode causar indisponibilidade compartilhada sob abuso; reavaliar por tráfego antes de PROD.
- Variáveis existentes usadas: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SECRET_KEYS`). Valores secretos permanecem somente no ambiente Edge, nunca no cliente ou Git.
- Feature gate `partner_config.enabled`: nasce false; habilitado somente em TEST após testes. Zero parceiros persistidos após rollback. Desativar o gate bloqueia RPCs novas e oculta busca; não apagar evidências/migrations para rollback operacional.
- Render TEST `srv-date0i6k1f9s73ft9vo0`, workspace `tea-da7iss0u01pc73d6vflg`, publish `preview`, build planejado `npm run build:test`. O build copia os mesmos assets TEST e cria aliases `/admin/` e `/admin/parceiros/`, preservando `/site/admin/`. Estado LIVE final deve constar no CURRENT-STATE.
- PROD `srv-davto4tg1s2s73brihf0`/Supabase `oslefjmwfnddxlotalxu` não recebem esta migration/Edge/configuração. PROD permanece `8035511`, auto-deploy OFF; main/V2.9 preservados.

## Comportamento e segurança

Cadastro público/contato por OWNER/ADMIN; VIEWER somente leitura sem contato/CPF. Rascunho recebe slug/código únicos, sem PII, mantidos ao renomear/arquivar. Homônimos e nomes longos recebem sufixo opaco sob lock. Ativação exige email/telefone e perfil financeiro validado pelo OWNER, percentual explícito 0–100 com até duas casas, sem default.

Financeiro exclusivo OWNER: senha em cliente Auth temporário sem persistência, novo TOTP e promoção da sessão somente após sucesso. Backend exige membership ativa, AAL2, sessão Auth existente, evidências password+totp recentes do JWT emitido pelo Auth e fator verificado. Ticket expira em cinco minutos, uso único, ligado a usuário/sessão/alvo/hash do payload. Dados pessoais/PIX não aparecem em busca nem auditoria; auditoria registra ator, ação, alvo, versão, percentual anterior/novo, motivo e documento mascarado. Atualização financeira exige reinformar dados completos; não há endpoint que devolva PIX/CPF integral.

Consulta pública/autocomplete na landing do cartão é **prévia P1**. Seleção não persiste intenção nem vínculo e informa isso visivelmente. P2 implementará atribuição e continuidade no onboarding. CTA e benefício existente preservados. Sem offline writes/cache de respostas privadas; SW existente não intercepta rotas admin novas.

## Evidências técnicas — PASS em 06/10/2026

- Focados `node --test tests/partners-p1.test.mjs`: 10/10.
- Regressão `node --test tests/*.test.mjs`: 442/442, zero fail/skip; inclui todos os fluxos anteriores.
- PostgreSQL local PGlite 0.5.8: runner `scripts/test-partners-sql-local.mjs`, `PGLITE_MODULE` aponta instalação temporária externa ao repo. Assertions PASS e rollback.
- PostgreSQL TEST real: concatenados `supabase/tests/partners_p1_test.sql` + `partners_p1_assertions.sql`, PASS/rollback; nenhum Auth signup, benefício, cobrança, envio ou mudança permanente de membership. Claims simuladas somente dentro da transação, **não comprovam E2E Auth humano**.
- SQL cobre homônimos/nomes longos, estabilidade slug/código, bloqueio de ativação incompleta, documento inválido, percentual explícito, hash divergente, replay/expiração do ticket, VIEWER/ADMIN, membership inativa, AAL1, AAL2 sem provas recentes, sessão revogada, projeção pública, busca código/min2/wildcards, quota e grants.
- Sintaxe JS, `build:test`, `build:public` local e diff-check PASS; build public local não constitui deploy PROD.
- HTTP Edge v1 desativada: 200 `enabled=false,partners=[]`. v2 habilitada: 200 `enabled=true,partners=[]`; origem PROD: 403 `ORIGIN_DENIED`.
- Layout DOM com fixture sintética sem Auth em viewport 390×844: formulário uma coluna, scrollWidth 375 ≤ viewport 390. Captura de screenshot após ajuste indisponível por timeout do navegador; não registrar PASS visual humano.
- Advisors TEST: nenhum ERROR, sem FK nova sem índice. Seis INFO RLS sem policy intencionais (acesso somente RPC), cinco WARN SECURITY DEFINER autenticadas intencionais com autorização backend, quatro INFO índices ainda não usados. Avisos preexistentes de senha vazada/anon SECURITY DEFINER/FKs gerais permanecem. Referências: [RLS](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [RPCs DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [índices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Revisão dos arquivos novos/diff: sem tokens/JWT/chaves privadas/arquivos de credenciais. Logs/preview/fixture/dependência SQL fora do versionamento.

## Pendências humanas focadas

No módulo novo em homologação: cadastrar parceiro de QA autorizado, confirmar rascunho e homônimo; OWNER configurar com percentual escolhido e **novo step-up senha/TOTP** (falha/cancelamento não salva), ativar; confirmar ADMIN sem financeiro e VIEWER sem escrita/dados privados; copiar/compartilhar link e buscar por nome/código em celular; suspender/arquivar e conferir ausência na busca. Não refazer bootstrap senha/TOTP, cartão, pagamento, recuperação ou demais PASS/NÃO REPETIR. Não usar identidades/PIX reais em QA sem necessidade e autorização.

Concorrência entre sessões e E2E Auth do novo step-up ainda precisam de validação focada; uniqueness/lock e replay foram validados tecnicamente conforme acima. Sessão operacional 8h em todos os caminhos admin pertence ao P4. Nada de P2+ ou PROD antes de nova etapa autorizada.

**Próxima ação:** validar humanamente o P1 novo em TEST e registrar resultado; depois planejar P2 de intenção/vínculo atômico.
