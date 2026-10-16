# PepDay — retomada operacional de segurança (15/10/2026, Brasília)

## Escopo
Continuidade autorizada pelo proprietário com "vamos", após auditoria oficial, para sincronização do Mac e inspeções somente leitura. **Não** constitui autorização para deploy PROD, ativar WhatsApp/Ads, registrar documentos reais, aplicar migrations, contratar serviços, criar backups com dados de clientes ou reutilizar VPS de outro projeto.

## Fontes e sincronização
- Repositório oficial: `wpontieri-boop/pepday`; `AGENTS.md`, `docs/CURRENT-STATE.md` e operações de segurança/recuperação consultados.
- GitHub HEAD `v3.0-bloco-b`: `ed21b88cadb254834873a8166cac6c7acca8fd01`.
- Mac `/Users/mdc/Projects/pepday`: antes HEAD `60c9dd1`, árvore limpa e 0 à frente/12 atrás. `git fetch origin --prune`, merge **somente fast-forward** até `ed21b88`. Fetch final, HEAD=origin, divergência **0/0**, árvore limpa.
- PC CenterPhone `C:/Users/wagne/Documents/PepDay-V3`: `git fetch`, HEAD=origin `ed21b88`, divergência **0/0**, árvore limpa, confirmado na auditoria precedente.
- Branch `main`/V2.9 não alterada. Nenhum commit funcional, reset, conflito ou sobrescrita.

## Ambientes verificados diretamente no Render
- TEST `srv-date0i6k1f9s73ft9vo0`, último LIVE `dep-db8jmqgae00c73a844s0`, SHA **`40a9deb231677780b57d534d9de4af208c6658af`**; autodeploy configurado ON.
- PROD `srv-davto4tg1s2s73brihf0`, último LIVE `dep-db8kv459fdbs739o8jr0`, SHA **`fc12b0a6271882097671373c6bd5ea8587f87f81`**, autodeploy OFF. Ads reais OFF conforme checkpoint aprovado. Nenhum deploy provocado nesta inspeção.
- Commits de ensaios de segurança posteriores ao build publicado são **fonte no GitHub**, não scanner/backup hospedado nem novo deploy.

## Segurança / prontidão real
- Supabase TEST `fsbqpyyprtymwrmzsacp` consultado por API: **ACTIVE_HEALTHY**, PostgreSQL **17.6.1.166**, organização PepDay plano **Free**. Sem SELECT de dados pessoais, escrita, dump ou mudança de configuração.
- Advisors security por leitura: **54 INFO** `rls_enabled_no_policy`; WARN: **1** `anon_security_definer_function_executable`, **60** `authenticated_security_definer_function_executable`, **1** `auth_leaked_password_protection`; **0 ERROR** no retorno. São alertas conhecidos que exigem revisão contextual, não prova de ausência de risco nem autorização para liberar tabelas.
- Mac macOS 26.6.1 arm64/Homebrew: `git`, `node`, `openssl` presentes; `supabase`, `psql`, `pg_dump`, `pg_restore`, `clamscan`, `freshclam`, `gcloud`, `docker`, `podman` ausentes no PATH. Nenhuma instalação.
- Documentação oficial Supabase: backups diários gerenciados oferecidos para Pro/Team/Enterprise; plano Free requer exportação externa regular. Backup de banco **não inclui bytes de objetos Storage**. Não presume backup configurado por plano Free.
- ClamAV real com EICAR/base QA e restore sintético LOCAL têm PASS registrado anteriormente; **não repetidos**. Falta ClamAV com assinaturas oficiais atuais/worker privado persistente e `pg_dump`+Storage para destino cifrado durável + alvo RESTORE isolado. **NÃO PASS operacional**.
- Google Cloud: `gcloud` ausente e console não consultado; restrições atuais/referrers/quotas de chaves TEST/PROD **NÃO VERIFICADAS**. Não expor, revogar ou rodar rotação da chave PROD por inferência.
- Meta/WhatsApp: integrações de parceiros continuam simuladas/disabled em TEST; sem WABA/Phone ID/templates aprovados/consentimento operacional comprovados; **ZERO envio real**.
- P3/fiscal: CSV e portal sintético TEST preparados; retenções, documentos, competência, guarda e calendário dependem de definições da contadora. Nenhuma coleta, contrato definitivo, ativação de parceiro ou repasse.
- Preservados integralmente os PASS HUMANO/NÃO REPETIR documentados (calculadora, PWA, push, Auth/Admin/2FA, PRO/checkout/recovery, cartão/QR, Central de Ajuda, P1/P2, fiscal TEST e páginas públicas).

## Próxima ação explícita
**Confirmar um runtime privado dedicado PepDay e um alvo seguro de restauração isolado, sem usar automaticamente VPS de outro projeto**. Somente com acesso/escopo autorizados instalar dependências PG17 e ClamAV oficial, validar atualização das definições/fail-closed, depois exportar TEST+Storage para destino cifrado com chave em custódia separada e restaurar no alvo isolado. Em paralelo, recuperar acesso ao console Google Cloud para inspecionar chaves sem exibir valores; continuar aguardando contadora e conta/número Meta. **Não executar dump real, criar serviços/custos, enviar mensagens, coletar documentos ou alterar PROD antes de autorização específica.**

## Evidências de consulta
- Git / Remote Desktop Commander Mac e PC: comandos `branch`, `status`, `fetch`, `merge --ff-only`, `rev-list`, `rev-parse`.
- Render: `get_service` / `list_deploys` TEST e PROD (somente leitura).
- Supabase: `get_project`, `get_organization`, `get_advisors` (somente leitura).
- Docs oficiais: https://supabase.com/docs/guides/platform/backups e https://docs.clamav.net/manual/Usage/SignatureManagement.html .
