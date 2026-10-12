# PepDay — preparação de segurança para ativação

Data: 12/10/2026. Base oficial `60c9dd1`, branch `v3.0-bloco-b`. Revisão jurídica interna aprovada pelo proprietário preservada. **Não é liberação de coleta, contrato real, WhatsApp ou PROD.**

## Resultado por frente

| Frente | Evidência executada | Situação operacional |
|---|---|---|
| Documentos/antimalware | Worker filesystem privado, 0700/0600, MIME/magic/tamanho, estado de quarentena, hash, promoção por rename atômico, capacidade limitada, capability autenticada por dono/uso único/30s, limpeza/120s; testes de revogação e adulteração | Preparação TEST isolada. Sem rota pública ou integração com Storage/portal. Scanner genérico hospedado ainda bloqueado |
| ClamAV | Engine **1.5.3 real**: PNG sintético limpo, EICAR e EICAR em PDF detectados; **base QA customizada limitada** | Assinaturas oficiais atuais NÃO disponíveis. FreshClam falhou `initgroups/Failed to switch to root`; download oficial `daily.cvd` HTTP403. Adapter exige CVD/CLD oficial recente, validação do engine e nega falhas; ensaio com base QA não fecha antimalware operacional |
| Recuperação | PostgreSQL **17.5/PGlite 0.3.14**: cluster sintético exportado/restaurado; duas linhas e dois arquivos; estruturas, constraints, grants, RLS e hashes iguais; dono A/B, anon/escrita indevida negados; AES-256-GCM, AAD, chave errada/adulteração/PROD negados | PASS do ensaio LOCAL. Não é dump/restore do Supabase TEST 17.6, nem backup periódico externo |
| Google | Inventário atual e histórico por fingerprints, sem valores; consumidores e separação TEST/PROD identificados | Console Cloud TEST retornou **Site Unavailable / Unable to access this site**. Sem plugin Google Cloud/CLI autenticada acessível; Mac remoto não respondeu. Restrições, quotas/uso e revogação não reconfirmados |
| Privacidade | Allowlists por finalidade, diagnóstico sem valores, retenção indefinida bloqueada, legal hold, solicitação por dono/identidade, opt-out separado, incidentes com metadados mínimos | PASS de políticas QA; nenhum direito ou exclusão real executado. Parâmetros fiscais e prova operacional de fornecedores/canal continuam necessários |

## Isolamento e infraestrutura existente

- Cópia independente obtida do GitHub, fetch/HEAD=origin/0/0/limpa antes do código. Consulta ao Mac `/Users/mdc/Projects/pepday` não respondeu; nenhum arquivo da máquina sobrescrito. CenterPhone offline. GitHub é a referência para atualizar ambas as cópias com comparação posterior.
- Supabase TEST `fsbqpyyprtymwrmzsacp`: organização **Free** confirmada por MCP; PostgreSQL 17.6; 17 usuários, 2 parceiros, 0 convites e 0 objetos. Dois buckets privados, limite 5MiB. 51 migrations. Não aplicamos migration nem escrevemos dados remotos.
- Schemas partner_portal/partner_whatsapp: **0 violações** de RLS/grants diretos anon/authenticated na consulta do catálogo. Policies Storage `partner_documents_server_only` e `portal_synthetic_server_only` restritivas preservadas.
- Advisors atuais: 0 ERROR; INFO RLS sem policies 54; WARN 1 anon DEFINER, 60 authenticated DEFINER e proteção de senha vazada desabilitada. São os avisos existentes: não relaxar guardas nem mudar Auth aprovado para limpar o painel.
- Render PepDay TEST e PROD são **static_site**, não executam ClamAV/worker Node persistente. Não usar o backend WP Imports ou a Central IA como scanner, backup ou banco PepDay sem desenho/autorização específicos. Não criamos serviços, projetos, assinatura ou custo.
- Ferramentas temporárias de teste fora do Git: ClamAV via pacotes Ubuntu assinados/extratos, PGlite 0.3.14, Playwright 1.56.1/Chromium 141. Não instalamos daemon no Mac/PC; nada permanece como tarefa comercial agendada.

## Contrato do worker preparado

Fontes `scripts/security/clamav-scanner.mjs` e `private-document-worker.mjs`, sem inclusão no build público. `init()` exige diretório dedicado novo; documentos exclusivamente de ensaio QA e contexto autorizado por callback confiável do servidor. O atributo `synthetic` é declaração do operador do ensaio, não autenticação de um endpoint. **Não expor esta classe diretamente a requisições de usuários.**

Scanner executado sem shell; tempo e saída limitados; limite de arquivos/recursão/descompactação; exceder limite é alerta/negação. A prova precisa ligar hash, versão do motor, versão/build das definições e horário. Definições com idade maior que 48h, motor indisponível, arquivo alterado, revogação ou expiração impedem promoção. O worker não aceita proof externo do navegador. Adapter usa `--official-db-only=yes` e `--fail-if-cvd-older-than=2`; o runtime deve manter certificados oficiais ClamAV e arquivos de assinatura exigidos pela versão instalada. Não desabilitar verificação para fazer o teste passar.

Staging não produz link. Capability de download exige autenticação novamente, dono idêntico, hash íntegro e uso único; revalida autorização após leitura. Resposta futura deverá usar attachment/no-store/nosniff, sem URL pública. O token não entra em arquivo/log/auditoria. Só ficam UUID técnico, evento e horário. `expire()` remove bytes e links; `dispose()` elimina o diretório dedicado do ensaio. Exclusão lógica de arquivo não promete apagamento forense.

**Limites:** metadata/capabilities e auditoria do ensaio ficam em memória; reinício nega acesso, não recupera estado nem fornece cleanup agendado durável. Para receber arquivos reais, implementar binding persistente de parceiro/convite/objeto, transação server-side de promoção, scanner hospedado com atualização oficial e isolamento de processo, limites/filas, limpeza de órfãos e API autenticada com revalidação de sessão. A promoção atômica local não é atomicidade entre PostgreSQL e Supabase Storage. EICAR não prova detecção de todo malware. MIME/magic é preflight, não sanitização de PDF nem garantia contra arquivos poliglotas. A guard exata do PNG no portal publicado continua intacta.

## Backup operacional preparado: o que falta para fechar

Não exportamos usuários, documentos ou dados reais para scratch. O runner `scripts/test-isolated-postgres-storage-recovery.mjs` cria exclusivamente o próprio cluster QA, sela o data-directory e arquivos separados, restaura outro cluster e compara catálogos/ACL/RLS/linhas/hashes. Chave efêmera 32 bytes, fora do pacote, zerada ao terminar; diretórios/arquivo cifrado 0700/0600, removidos ao terminar. Cada objeto tem hash e dono QA. Este mecanismo PGlite é de ensaio, não formato substituto do `pg_dump` remoto.

O próximo ensaio remoto exige recursos existentes demonstrados, sem contratação:

1. Credencial/conexão privada de exportação **exclusivamente TEST**, com privilégio suficiente para dump de schemas, funções, políticas, owners/grants, sequências, extensões e roles pertinentes (sem senhas). Usar serviço/arquivo privado, nunca token/URL com senha em argv, Git ou relatório. CLI, `pg_dump` e `pg_restore` compatíveis com PostgreSQL 17; não usar pg_dump 16 sobre TEST 17.
2. Destino durável privado aprovado, chave em controle separado e cópia cifrada autenticada. Scheduler e alertas de falha verificáveis. RPO/RTO devem ser medidos; não presumir. Retenção técnica de backup deve ser configurada separadamente do prazo fiscal, com proteção a legal hold/direitos e expiração das cópias.
3. Inventário e exportação **separada** de todos os buckets/objetos via Storage autenticado, páginas completas, hashes e metadados mínimos; negar bucket público inesperado. O dump PostgreSQL contém metadados Storage, não os bytes dos objetos. Sem consistência temporal garantida, bloquear novas escritas no ensaio ou repetir inventário/hashes e falhar se divergir.
4. Alvo isolado TEST, sem cron/webhooks/envios/payment workers ativos; sem domínio/credenciais de PROD. Não restaurar sobre o projeto TEST de homologação em uso. Testar DB e objetos no alvo, comparar esquema/linhas/constraints/sequências/grants/RLS/hashes e negação de acesso cruzado.
5. Remover somente fixtures descartáveis, guardar evidência mínima e provar a agenda real. Sem esses itens, status permanece pendência operacional, mesmo com o ensaio local PASS.

**Bloqueio atual objetivo:** MCP disponibiliza SQL/metadata, mas não exportação binária completa/Storage+segredo operacional/scheduler/destino seguro; Mac remoto indisponível; organização Free/sem terceiro alvo isolado demonstrado. Não compramos PITR, disco, instância ou projeto. Backups automáticos/PITR e restauração remota não foram presumidos nem executados.

Referências oficiais consultadas: [Supabase Backups](https://supabase.com/docs/guides/platform/backups), [PGlite API](https://pglite.dev/docs/api), [ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html), [Signature management](https://docs.clamav.net/manual/Usage/SignatureManagement.html). Changelog Supabase consultado: mudanças de TLS CBC e minor releases não motivaram alteração dos ambientes nesta sessão.

## Google: inventário e retomada sem segredos

| Fingerprint SHA256 parcial | Projeto/consumidores | Estado |
|---|---|---|
| c4344465108883b7 | pepday-v3-test; firebase-public-config.mjs / firebase-messaging-sw.js | Chave pública Firebase cliente atual TEST |
| c7c28ff21ddb0313 | pepday-v3-prod; arquivos equivalentes `.production` | Chave pública Firebase cliente atual PROD, intocada |
| dfe1c9cd6c2f71d6 | versão histórica PROD antes da correção e1d52bf | Valor histórico com erro de digitação; não afirmar que foi revogado no Google Cloud |

Os três alertas `resolved/wont_fix` são registro anterior, não auditoria nova do endpoint Secret Scanning. Registros antigos relatam restrições por domínio TEST/PROD e push aprovado; esse PASS histórico não foi apagado/repetido. A situação atual de restrições Cloud não pôde ser observada.

Próxima inspeção, quando conta Cloud estiver acessível: mapear resource IDs sem valores completos; confirmar domínio/referrer exatos TEST e PROD, APIs Firebase Installations/FCM necessárias conforme uso, quotas e consumo. Para chaves server-side apenas, conferir restrição IP quando aplicável; referrer/IP não são alternativas intercambiáveis para o mesmo cliente. Service accounts/OAuth/VAPID são dependências diferentes, não estas Web API keys. Corrigir apenas chave TEST dedicada após conferir dependências; não revogar PROD às cegas. Script `scripts/security/google-key-inventory.mjs` reproduz o inventário público sem imprimir valores.

## LGPD: cobertura existente e controles independentes

| Requisito | Instrumento existente / controle preparado |
|---|---|
| Finalidades/bases/minimização | Aviso de privacidade e responsabilidades; allowlists identity/representation/payment/fiscal/contract/security/channel, nenhuma coleta universal de selfie/RG |
| Prestadores/compartilhamento | Aviso limita por necessidade e finalidade; inventário operacional deve confirmar DPA/fluxo internacional efetivo de Supabase/Render/Meta/contabilidade. Não presumir acordo apenas pela minuta do parceiro |
| Direitos | Canal alternativo previsto no contrato/aviso; QA nega titular A consultar B, exige identidade, não apaga documento automaticamente por opt-out |
| Retenção/exclusão | Matriz fiscal continua pendente; policy indefinida bloqueia exclusão; legal hold prevalece; TTL técnico de quarentena não é prazo fiscal |
| Acesso/auditoria | Backend OWNER/AAL2 existente preservado; novo worker exige callback confiável e dono; incidentes aceitam só enum/referência/horário, rejeitam conteúdo, telefone/token |
| Incidentes | Fluxo preparar→conter→avaliar→revisar comunicação→encerrar; registrar internamente escopo/risco/medidas em canal privado e cumprir regulamentação ANPD aplicável. Nenhuma notificação real enviada |

`scripts/security/privacy-controls.mjs` é política QA independente, **não endpoint nem autorização baseada em booleans do cliente**. `verified`, aprovação de policy e ator serão obtidos do backend confiável em futura integração. Não altera P1/P2/P3, contratos/hashes preparados, percentuais, obrigações fiscais ou Auth. Dados e condições das partes precisam ser preenchidos antes do aceite real.

## Testes e limites da homologação

- **19/19 focais novos PASS**, **612/612 regressão serial PASS**, zero falha/skip. Casos de scanner com prova/mock são testes unitários explicitamente identificados; evidência do engine ClamAV real é o runner separado.
- ClamAV real QA clean/EICAR/embedded EICAR PASS após incluir os certificados oficiais do pacote `clamav-base`. Tentativa inicial sem certificados falhou, corrigida sem desabilitar verificação. Definições oficiais gerais continuam bloqueadas; isso não foi convertido em PASS.
- Restore PostgreSQL/PGlite+arquivo local PASS, dois donos/objetos, catálogo/ACL/RLS e integridade. Não exportou banco remoto.
- Build TEST PASS. Browser Chromium/Playwright em **390×844 e 1280×900**: nove documentos/hash/aceite desabilitado e origem/projeto/hash incorretos negados. Backend interceptado/zero writes. Nenhum teste humano repetido ou novo PASS HUMANO inferido.
- Não há mudança de UI/fluxo do funcionário; Central de Ajuda e Word **v1.5** permanecem corretos e não precisaram edição. Nova documentação é técnica para implantação futura.
- Evidências reproduzíveis versionadas em [JSON](ACTIVATION-SECURITY-EVIDENCE-20261012.json); logs completos locais ignorados, hashes registrados, scripts/tests no Git. Testes não substituem avaliação de scanner hospedado, integração Storage, canal real ou dados/contratos reais.

## Dependências e próxima ação exata

Externas previstas: **contadora** (CPF/MEI/CNPJ, emissão/retenções/competência/calendário/guarda) e **número empresarial único/Meta** (conta, WABA/Phone ID, templates, OTP entregue, consentimento). Revisão interna aprovada: não exigir advogado externo automaticamente.

Também permanecem impedimentos técnicos objetivos: runtime persistente do scanner com definições oficiais, exportação/restauração remota durável autorizada, acesso Cloud para inspeção, e prova de fornecedores/canal alternativo/identidade proporcional. Não declarar que só duas dependências restam quando esses controles ainda não são operacionais.

**Próxima ação:** em ambiente privado existente acessível, demonstrar definições oficiais/worker persistente e dump TEST+Storage/restauração isolada; recuperar inspeção Google Cloud; então aplicar parâmetros fiscais e Meta em TEST e validar apenas os fluxos novos. PROD exige autorização própria futura. WhatsApp permanece disabled/real_send=false/real_collection=false/central_enabled=false: zero resposta a parceiro, zero LLM, zero encaminhamento ao OWNER, sem destinatário real.

## Publicação e sincronização

Fechamento só de preparação técnica/TEST. Como não há alteração no frontend, o deploy TEST aprovado `cd901a6` / `dep-db6i0crncjis73c3blb0` pode ser preservado sem republicar assets. Publicação de fontes/scripts no Git não significa scanner ou backup hospedado. PROD baseline `166de8f` / `dep-db4gualg1s2s739d8sn0`, auto-deploy OFF; main `25f1d48d34b395be285d35391b6a5b7ebe6d848c`. Registrar aqui a confirmação de push/fetch e deploys após o commit final.
