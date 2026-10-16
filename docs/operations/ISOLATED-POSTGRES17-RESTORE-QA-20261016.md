# PepDay — ensaio de restauração isolada PostgreSQL 17.11, dados sintéticos

Data: **16/10/2026**, PC CenterPhone, branch `v3.0-bloco-b`. **SEM DADOS REAIS, SEM BACKUP OPERACIONAL.**

## Fonte oficial e segurança de execução
- Antes da alteração foram consultados integralmente `AGENTS.md` e `docs/CURRENT-STATE.md`, junto a `POSTGRES17-PORTABLE-CLIENT-20261016.md` e `BACKUP-TEST-PREPARATION-20261016.md`.
- Git inicial após fetch: HEAD=origin `641d873c151a4705a0896e24226bbe12a9aacc60`, branch correta, divergência 0/0, árvore limpa. Render TEST LIVE `40a9deb`, PROD LIVE `fc12b0a`, sem deploy.
- Proprietário autorizou continuar sem novas perguntas. Sua chave real está **somente no WhatsApp** por escolha declarada, insuficiente como única custódia resiliente para backup definitivo. Este ensaio **NÃO** usa, lê, exporta, registra ou pede essa chave; PASS HUMANO / NÃO REPETIR da verificação da chave permanece preservado.
- A etapa não precisa de credenciais TEST, números WhatsApp Meta, contadora ou servidor Hostinger. Não reutiliza Central IA, WP Imports, Supabase TEST/PROD ou dados de clientes.

## Runtime local em PC
- Utilitários PostgreSQL 17.11 da etapa anterior preservados em `%LOCALAPPDATA%\\PepDay\\tools\\postgresql-17.11\\pgsql\\bin`.
- Para o ensaio de inicialização local, foram acrescentadas as pastas `pgsql/share` e `pgsql/lib` **do mesmo ZIP oficial EDB 17.11-3**. A integridade do arquivo foi confirmada **antes das duas extrações** via SHA-256 `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf` (checksum publicado pelo fornecedor e já documentado); ZIP temporário eliminado.
- Nenhum instalador/serviço do Windows, PATH global, servidor persistente, contêiner ou cobrança criado. São somente bibliotecas portáteis locais e cluster QA descartável no TEMP do usuário.

## Ensaio executado: PASS TÉCNICO SINTÉTICO
Arquivo reproduzível: `scripts/security/synthetic-pg17-restore-qa.mjs`. Invocação **sem argumentos**: `node scripts/security/synthetic-pg17-restore-qa.mjs` no PC Windows com runtime local preparado. Não possui modo remoto, parâmetros de destino ou caminho de Supabase.
- Cria diretório privado exclusivo no TEMP `pepday-synthetic-pg17-*` e cluster com `initdb` PostgreSQL 17.11. Autenticação local SCRAM-SHA-256 com senha QA aleatória em arquivo temporário, excluído após inicialização; segredo não exibido em logs/comando ou salvo no repositório.
- PostgreSQL escuta **somente 127.0.0.1**, em porta dinâmica determinada localmente. Sem chaves ou URLs de provedores; sem conexões de saída configuradas, sem e-mails, pagamentos, WhatsApp ou cron.
- Cria tabela fictícia `qa.events` com 2 linhas `QA-ALPHA`/`QA-BETA`, PK/identity, CHECK, RLS e policy `qa_by_owner`.
- Exporta com **`pg_dump -Fc`**, sela com **AES-256-GCM** e chave QA efêmera aleatória (diferente da chave do proprietário), IV aleatório de 96 bits, tag128 e AAD de escopo sintético. Apaga o primeiro arquivo plaintext, confere hash/integridade, rejeita bytes adulterados antes de continuar, decifra em arquivo QA privado.
- Cria banco novo `qa_restore` a partir de `template0` dentro desse mesmo cluster local, chama `pg_restore --exit-on-error --no-owner --no-privileges` e verifica hash lógico do conteúdo, 2 registros, 1 policy, 2 constraints (PK/CHECK), RLS habilitada e sequência retornando **3** na próxima inserção.
- `finally` para o banco via `pg_ctl stop`, zera chave efêmera e remove **somente** pasta QA recém-criada após parar; se não conseguir parar, nega limpeza e exige revisão para evitar apagar cluster ativo. Não remove diretórios pré-existentes ou do usuário.
- Resultado real retornou `status=PASS_SYNTHETIC_ISOLATED`, `records=2`, `rls=true`, `policyCount=1`, `checks=2`, `sequenceRestored=true`, `aes256gcmRoundtrip=true`, `tamperDenied=true`, `remoteSupabaseTouched=false`, `realBackupProven=false`.
- Verificação posterior: **0** processos `postgres` executando e **0** diretórios `pepday-synthetic-pg17-*` restantes no TEMP.

## Falhas intermediárias tratadas sem falsear PASS
1. `initdb` falhou inicialmente porque as DLLs do diretório `pgsql/lib` ainda não tinham sido extraídas. Resolvido usando os módulos oficiais do mesmo ZIP validado; processo deixou zero servidor ativo.
2. `pg_ctl start` iniciou o servidor mas manteve pipes herdados pelo subprocesso. Após timeout, `finally` parou o servidor; correção: stdio `ignore` somente no comando `pg_ctl`, mantendo PostgreSQL com log no diretório QA.
3. O último teste de sequência falhou porque `psql` retornava também o comando `INSERT`. Adicionado `-q` ao cliente de consulta; rerun demonstrou ID esperado=3.
Nenhuma dessas falhas foi ignorada; somente o último ensaio integral bem-sucedido foi marcado **PASS SINTÉTICO**.

## Testes e limites
- `tests/synthetic-pg17-restore-qa.test.mjs`: **6/6 PASS**, incluindo fail-closed local, AES-GCM roundtrip, negação de chave errada/tamper IV/tag, nonces distintos, isolamento loopback, limpeza e import seguro.
- Regressão completa PC **672/672 PASS**, zero falhas/skip; `npm run build:test` **PASS**, script privado fora de `preview/`, `git diff --check` PASS.
- **NÃO é restore de Supabase TEST 17.6.** Ainda não cobre extensões Supabase, schemas remotos Auth/Storage/partner_portal/partner_whatsapp, roles globais, Storage bytes reais, `pg_dumpall`, backup na nuvem, retenção, RPO/RTO remoto, agenda, integridade entre snapshots, custódia independente de chave ou certificação de ClamAV.
- `--no-owner --no-privileges` foi usado **somente para esse fixture local**; não usá-lo como atalho de dump/restauração Supabase real, onde owners/grants/RLS exigem reconciliação explícita.
- Dependências externas adiadas permanecem apenas WhatsApp/Meta real e contadora. Segurança, backup e revisão do release permanecem no plano; produção, main/V2.9 e Central IA intocados.

## Próxima ação curta
**Preparar contrato/pipeline sintético de exportação paginada dos objetos Storage e manifesto autenticado DB+Storage**, sem credenciais reais; depois identificar/autorizar credenciais privadas TEST e alvo real de restauração isolado antes de qualquer exportação de dados.

## Complemento — contrato sintético DB + Storage
- Preparado `scripts/security/storage-pagination-qa.mjs`, **sem acesso Supabase/HTTP**, que recebe paginador/leitor injetado somente para dados QA `QA-*`, valida continuidade de cursor, IDs distintos, MIME permitido, tamanhos e bytes completos, rejeitando duplicata, traversal, cursor repetido e paginação parcial.
- Integrado ao envelope QA já existente `scripts/security/isolated-recovery.mjs` para selar **banco sintético + bytes dos objetos QA** com AES-256-GCM, verificar abertura sob alvo `test-isolated-restore` e negar adulteração ou chave incorreta. Testes percorrem três objetos fictícios em duas páginas e também cobertura de inventário vazio. SHA256 calculado por objeto e no ciphertext.
- `tests/storage-pagination-qa.test.mjs`: **8/8 PASS**. Juntos com `tests/synthetic-pg17-restore-qa.test.mjs`, focados **14/14 PASS**, regressão global **672/672 PASS**, build TEST PASS. Nenhuma chave humana, dado real, conexão, upload, processo persistente ou publicação.
- Limite explícito: o contrato é *apenas sintético*, não prova acesso/autorização aos buckets do Supabase TEST, não comprova consistência temporal DB+Storage remoto, nem transfere dados para Drive. Os gates de backup REAL continuam OFF. **Próximo passo:** especificar integração PRIVADA autenticada ao Supabase TEST e alvo de restore real isolado, sem executar exportação até autorização e custódia resiliente da chave.
