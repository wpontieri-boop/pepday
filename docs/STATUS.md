# Ponto de retomada — Bloco A, checkpoint A3 — validação do banco

Estado: **integração de conta preparada; Bloco A ainda incompleto**.

## O que mudou nesta etapa

- Projeto de testes confirmado: pepday-v3-test / fsbqpyyprtymwrmzsacp.
- A chave publishable do proprietário responde HTTP 200 em /auth/v1/settings.
- Provedor e-mail habilitado; Google desabilitado.
- Instalação SQL confirmada pelo proprietário em 2026-09-10.
- Suite SQL completa confirmada pelo proprietário: sem erro, final com rollback.
- Verificação independente: profiles e vials retornam HTTP 401 / 42501 sem login;
  get_entitlement também nega execução anônima (401 / 42501).
- config.js contém somente configuração pública do projeto de testes.
- SDK oficial 2.116.0 salvo localmente em vendor/, com origem, SHA-256 e licença.
- index.html integra o novo Perfil sem alterar cálculo, seringas ou navegação.
- account.css afeta somente controles novos; style.css permanece idêntico à V2.9.
- src/account-ui.mjs integra envio/verificação de OTP, Google condicionado à
  configuração, sessão, logout, formulário de cadastro e revisão de backup legado.
- Consentimentos desabilitados até documentos reais e versões serem configurados.
- src/cloud.mjs valida projeto/chave pública, impede uso no caminho de produção,
  separa armazenamento Auth do ambiente de testes e traduz erros sem expor payloads.
- A importação confere no servidor o UUID esperado, protegendo contra troca de
  conta entre a criação do backup e o envio.
- sw.js usa cache V3.0 A2; Auth, query strings e respostas privadas ficam fora.
- Servidor de desenvolvimento sem dependências, usado somente em preview interno.

## Preservação

- main de produção não foi alterada. Branch de trabalho: v3.0-bloco-a.
- app.js, style.css, manifest.json e icon.svg continuam byte a byte V2.9.
- index.html e sw.js têm alterações somente na branch de desenvolvimento.
- Backup V2.9 original e hashes continuam disponíveis em backup/.
- Nenhum deploy, envio de e-mail, criação de usuário ou acesso com chave elevada.

## Testes executados

- 21/21 testes Node aprovados: backup, consentimento, troca de conta,
  verificação de snapshot, adaptador Auth, configuração pública e cache.
- Navegador desktop: Perfil carregado com e-mail disponível e Google desabilitado,
  tutorial de seis passos e repetição pelo Perfil funcionando.
- Navegador: 10 mg / 2 mL / 1 mg = 20 UI na seringa de 30 UI; 1000 mcg = 20 UI
  nas seringas de 50 e 100 UI. Exemplos apenas de teste matemático.
- SDK carregou localmente; nenhum erro JavaScript do aplicativo observado.
- Sintaxe JS, integridade SDK/backup e referências locais verificadas.

## Ainda NÃO validado/concluído

- O sucesso da suite SQL é evidência relatada pelo proprietário; os bloqueios
  anônimos da API foram verificados diretamente nesta sessão.
- Sem PostgreSQL/Docker/Supabase CLI local para rodar testes de banco nesta sessão.
- Login/logout reais, entrega de OTP, Google e sessão autenticada dependem de
  configuração do painel e teste do proprietário; não foram simulados como sucesso.
- Cadastro aguarda documentos acessíveis; os aceites não são fictícios.
- Migração guarda snapshot para revisão; ainda não converte e mescla registros
  em frascos/rotinas/aplicações da nuvem. Histórico incompleto não é reconstruído.
- Sincronização local-first e operações de saldo/undo são do Bloco B.
- Testes mobile, offline/update reais e testes completos dos blocos B/C/D pendentes.

## Próximo passo exato

Continuar com login real por e-mail, persistência da sessão, Perfil e logout.
Não repetir instalação nem suite SQL já concluídas. O resultado set_config no
SQL Editor não é uma falha; o rollback final pertence à limpeza dos fixtures.
Em seguida concluir a conversão/mesclagem do legado e validar duas sessões reais.
Google e documentos de consentimento continuam pendentes de configuração.
Somente encerrar A e iniciar B quando suas pendências estiverem resolvidas.
Manter a mesma branch e os arquivos existentes. Não refazer V2.9 nem publicar.
