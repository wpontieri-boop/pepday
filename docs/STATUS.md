# Ponto de retomada — Bloco A, checkpoint A4

Estado: **conversão/mesclagem implementadas e testadas localmente; Bloco A ainda não aprovado integralmente**.

## Evidências já aceitas — não repetir

- Instalação 202609090001 aplicada no pepday-v3-test pelo proprietário.
- Suite supabase/tests/block_a.sql executada pelo proprietário sem erro, com rollback.
- Acesso anônimo negado pela API em profiles, vials e get_entitlement (401 / 42501).
- Em 2026-09-10 o proprietário confirmou login real por e-mail, OTP de 6 dígitos,
  sessão preservada após recarregar e logout correto no ambiente V3.0 isolado.
- 21 testes Node anteriores e QA de calculadora/tutorial permanecem aprovados.

## Implementado neste checkpoint

- Migração incremental 202609100002_complete_legacy_import.sql; não altera a inicial.
- Conversão de frascos e rotinas com vínculo por conta, versão inicial da rotina e
  movimento de abertura com o saldo real importado, em uma transação.
- Identidade do legado por usuário/tipo/UUID; mesma entrada reaproveita o destino.
  Mesmo UUID em contas distintas recebe destinos distintos.
- Mesclagem não sobrescreve dados. Conteúdo divergente para a mesma identidade
  interrompe toda a chamada; não usa último registro como vencedor.
- Histórico de frascos, done e doseHistory são preservados integralmente em
  legacy_import_records.source_record e no snapshot original. Não são fabricadas
  aplicações nem concentrações históricas que a V2.9 não registrou.
- Conferência no servidor e releitura do recibo pelo cliente antes da confirmação
  local; identidade e hash são checados novamente depois do envio.
- Perfil oferece revisão com nomes/saldos, importação, mesclagem, manter dados da
  conta e agora não. Manter a conta não substitui o armazenamento local; a ligação
  das telas com a fonte de dados da conta continua pertencendo ao Bloco B.
- Cópia local e backup nunca são apagados automaticamente.
- Cache A4 inclui o módulo novo; servidor de desenvolvimento permite esse arquivo.

## Testes novos executados — sem repetir os antigos

- 8 testes Node do delta passaram: revisão, recibo, preservação, conta alterada,
  edição durante envio, duplicidade de IDs, consentimento e mensagem de conflito.
- SQL incremental executado com sucesso em PostgreSQL local via PGlite 0.5.8,
  obtido do npm com integridade conferida, fora das dependências do aplicativo.
- A suite incremental cobriu conversão, saldo, histórico preservado, idempotência,
  escolha de mesclagem, conflito sem sobrescrita, rollback de inserção parcial,
  RLS da nova tabela, acesso cruzado, IDs entre contas e bloqueio anônimo.
- O banco local é descartável e usa somente fixtures. A definição de auth.uid e a
  tabela auth.users foram mínimas para testar SQL; isso não prova configuração
  real de Auth, concorrência de sessões ou aplicação do delta no Supabase.
- Sintaxe de account-ui.mjs conferida. Nenhum novo teste real de login foi feito.

## Próxima dependência humana exata

No SQL Editor de **pepday-v3-test**, executar somente:

1. supabase/migrations/202609100002_complete_legacy_import.sql
2. supabase/tests/complete_legacy_import.sql

O segundo arquivo usa fixtures aleatórios e rollback, e exibe uma linha PASS.
Não executar de novo a instalação 202609090001 nem tests/block_a.sql.
Não compartilhar senhas, OTPs, service_role ou secret keys.

## Ainda pendente para encerrar A

- Confirmar instalação e testes do delta no Supabase.
- Publicar o checkpoint novo somente no ambiente isolado quando autorizado;
  o endereço de testes ainda serve o checkpoint anterior validado para login.
- Validar importação pelo Perfil com dados de teste e cadastro completo.
- Google está desabilitado: depende de configuração OAuth/redirect pelo painel;
  nunca solicitar segredo no chat. Configuração pública não foi alterada.
- Cadastro completo depende de Termos/Privacidade reais e versões. O preparo
  jurídico é do Bloco D, mas o aceite é pré-requisito do envio na interface e da
  conversão no backend. Não forjar aceites para testar com dados reais.
- Dados locais são separados por origem: a versão de testes não pode ler o
  localStorage do GitHub Pages de produção. Não interpretar origem vazia como
  perda de dados; não alterar produção para contornar essa separação.

## Continuação depois da aprovação de A

Avançar diretamente ao Bloco B sem nova autorização: gates FREE/TRIAL/PRO,
Rotina ↔ Frasco, mutações transacionais de aplicação/undo e sincronização.
Ao integrar o legado, respeitar o mapeamento de UUIDs e os dias done preservados;
não descontar novamente aplicações anteriores nem transformar histórico incompleto
em eventos novos. A escolha de usar a conta não autoriza apagar a cópia local.

## Preservação e publicação

Branch: v3.0-bloco-a. Nenhuma alteração em main/GitHub Pages/V2.9 de produção.
app.js, style.css, manifest.json e icon.svg preservados; backup V2.9 mantido.
Nenhuma publicação nova nesta etapa, nem promoção automática para produção.
Ambiente isolado existente: https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site
