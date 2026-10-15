# PepDay — recuperação sintética reforçada; auditoria operacional somente TEST

**Data:** 15/10/2026 (Brasília). **Repositório:** `wpontieri-boop/pepday`, branch `v3.0-bloco-b`. **Escopo autorizado:** segurança e recuperação TEST, sem PROD, dados reais, compras, deploy de serviços, mudança fiscal/Meta, credenciais ou novos uploads.

## Fontes de continuidade e proteção

Lidos integralmente `AGENTS.md`, `docs/CURRENT-STATE.md` e `docs/operations/ACTIVATION-SECURITY-PREPARATION-20261012.md`. Consultados documentos de segurança interna, evidência e mapa de URLs. Antes de alterar: `git fetch origin`, HEAD/origin `6f0842c339121553cb50a585e9c951358c040bdf`, divergência 0/0, árvore limpa, branch TEST. Recuperação PGlite/Storage sintética, ClamAV QA e validações humanas antigas mantidas como PASS/NÃO REPETIR.

## Verificações atuais por leitura

- **Render PROD:** `srv-davto4tg1s2s73brihf0` continua LIVE `fc12b0a6271882097671373c6bd5ea8587f87f81`; sem ação em produção. **Render TEST:** `srv-date0i6k1f9s73ft9vo0` LIVE `40a9deb231677780b57d534d9de4af208c6658af` antes da documentação desta sessão.
- **Supabase TEST** `fsbqpyyprtymwrmzsacp`, Postgres 17.6: consulta somente de contagens (**2 buckets, 0 objetos, 17 usuários de teste, 0 convites de parceiro**), sem ler dados pessoais e sem escrita/DDL/exportação de bytes; PROD Supabase `oslefjmwfnddxlotalxu` não alterado. Advisors de segurança com avisos históricos de RLS sem policies deliberadamente restritivas (54 INFO); consulta não é novo atestado de segurança global.
- **PC CenterPhone Windows:** Node/Git disponíveis; `pg_dump`, `pg_restore`, `clamscan`, `freshclam` ausentes no PATH; WSL não instalado. **Mac remoto:** respondeu como Online ao inventário, mas a tentativa de comando expirou; não declarar ferramentas instaladas. Não foi feita instalação, compra ou apropriação da VPS/infra de outro projeto.
- **Backup remoto completo:** sem credencial privada autorizada de dump TEST, sem prova de destino durável e chave sob custódia, sem alvo PostgreSQL+Storage isolado nem restauração remota. Não acessar dados de usuários TEST para simular progresso. Backup nativo PostgreSQL não contém bytes de objetos Storage.
- **Scanner operacional:** ClamAV oficial com assinatura recente, worker persistente e ligação segura ao portal não demonstrados. Portal existente continua restrito ao PNG sintético exato, sem coleta real. Nunca tratar ClamAV/engine QA anterior com assinaturas de teste como proteção operacional.
- **Google Cloud:** restrições de chaves TEST/PROD ainda não verificadas em console; nenhuma chave revelada, revogada ou modificada.

## Alteração de código local, fora do build público

- `scripts/security/isolated-recovery.mjs`: endurecimento da **abertura de pacote AES-256-GCM sintético**. Além do tag criptográfico, valida estritamente escopo TEST, formato Base64 canônico, hash SHA-256, nomes e tipos de propriedades permitidos, mime, ownership QA, unicidade dos IDs, limite de DB 64 MiB, objetos 5 MiB e total 96 MiB. Dados reprovados, até quando cifrados com chave válida, retornam `RECOVERY_DENIED`. Não são exportador de Supabase nem endpoint real.
- `tests/isolated-recovery-integrity.test.mjs`: novo teste de restauração QA válida e negações de pacote autenticado, porém semanticamente adulterado, duplicados, MIME, Base64, hash, tamanho e alvo PROD.
- **6/6 PASS** em `isolated-recovery.test.mjs` e `isolated-recovery-integrity.test.mjs`. `node scripts/build-test.mjs` PASS, `git diff --check` PASS. Não rodar novamente testes humanos/PWA/admin/cobrança já PASS; **nenhum novo PASS de backup operacional remoto ou ClamAV oficial**.
- Não incluído nenhum arquivo de cliente, segredo, senha, SQL remoto, dump, token, configuração produtiva, arquivo de backup ou artefato de malware no Git. Build TEST permanece visualmente o mesmo; alteração restrita a scripts server-side de ensaio.

## Pendências / próxima ação explícita

1. Obter **runtime privado isolado para PepDay** (não reaproveitar infraestrutura de outro projeto automaticamente), com ClamAV/FreshClam oficiais funcionais, arquivo de teste sintético e worker persistente. Verificar assinatura oficial recente, negação por engine indisponível, destino privado, amarração por hash e direitos, SEM ativar upload de dados reais.
2. Obter **alvo de restauração isolado**, destino cifrado durável/chave custodiada e conexão TEST autorizada; executar `pg_dump`/restore compatível com PG17 e exportação separada de Storage, com comparações de hash/ACL/RLS e rollback. Sem destino, não exportar TEST.
3. Recuperar console Google Cloud TEST; verificar restrições/referrers/uso sem alterar chave PROD.
4. Aguardar resposta da contadora e configuração do número Meta; flags real-send e real-collection permanecem OFF.

**Próxima ação curta:** confirmar runtime privado + alvo seguro exclusivos para PepDay antes de testar ClamAV oficial e backup TEST remoto. A documentação/PASS já aprovados não devem ser refeitos.
