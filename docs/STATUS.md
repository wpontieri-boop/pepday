# Ponto de retomada — 09/09/2026

Estado: **fundação do Bloco A; NÃO pronta para produção**.

## Base e isolamento

- ZIP original preservado em backup/PepDay_V2.9_Final_Publicada.zip.
- Seis hashes Git blob conferidos contra a main, todos idênticos.
- Base GitHub: 25f1d48d34b395be285d35391b6a5b7ebe6d848c.
- Branch de trabalho: v3.0-bloco-a.
- Nenhum deploy, alteração na main, conta paga ou configuração externa de Auth.

## Arquivos adicionados

- supabase/migrations/202609090001_block_a.sql: estrutura das 11 tabelas, RLS,
  grants, bootstrap, onboarding, entitlement, trial e recebimento de snapshot.
- supabase/tests/block_a.sql: casos de leitura entre contas, admin sem acesso
  global, bloqueio de autopromoção, trial único, bloqueio de escrita direta e anon.
- src/account.mjs: adaptador de Auth injetável.
- src/legacy-import.mjs: inspeção, backup, hash e recebimento para revisão.
- tests/block-a.test.mjs: 13 testes unitários com cliente e storage simulados.
- config.example.json, .gitignore, README.md, docs/STATUS.md, backup/SHA256.json.
- REQUISITOS.txt: prompt mestre original para continuidade.

## Validação e limites

- Executado: 13/13 testes Node aprovados.
- Executado: sintaxe JavaScript dos arquivos originais e módulos novos.
- Executado: integridade ZIP, hashes dos seis arquivos e referências locais HTML/manifest.
- Não executado: SQL/PostgreSQL/RLS real, concorrência no banco, login Google/e-mail,
  envio de OTP, sessão real, teste em dois aparelhos, migração completa,
  integração visual mobile/desktop, trial no servidor.
- Blocos B/C/D pendentes. Pagamentos, push, e-mails, sincronização e política de
  cache V3.0 não implementados aqui.

## Próximo passo exato

Configurar projeto Supabase de homologação, URL pública e publishable key.
O item 17 do prompt mestre exige parar quando forem necessárias credenciais ou
configuração humana. Não inventar chaves ou contornar esse ponto.
Depois, aplicar/testar SQL, instalar SDK oficial fixado, conectar conta à interface
sem redesenhar, completar migração revisada e executar validação real do Bloco A.

Não repetir backup ou reconstruir V2.9. Reutilizar esta branch e estes arquivos.
Não chamar snapshot recebido de importação concluída. Não converter histórico
incompleto em eventos supostamente exatos. Não habilitar escrita direta nas tabelas
de saldo/histórico para contornar a ausência das RPCs do Bloco B.
