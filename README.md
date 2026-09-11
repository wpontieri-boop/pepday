# PepDay V3.0

O PepDay V3 está em desenvolvimento controlado. O **Bloco A foi concluído e
aprovado** em 11/09/2026, tendo como commit-base aprovado
`724ba23f0a11c77eff1e9637fd26a9ad21ca026c`. O desenvolvimento do Bloco B parte
da branch `v3.0-bloco-b`. A Fase B1 (FREE/TRIAL/PRO) está implementada e testada
e foi concluída e aprovada. O backend B1 foi aplicado com sucesso no Supabase de
testes `pepday-v3-test`.

A V2.9 continua sendo a produção estável e não deve ser alterada até a aprovação
final da V3. Não promover esta branch para `main`, não alterar GitHub Pages e não
publicar em produção sem autorização expressa.

Ambiente atual de testes do Bloco A:
`https://pepday-v3-bloco-a-test.wpontieri.chatgpt.site/`

O registro detalhado da retomada está em [docs/STATUS.md](docs/STATUS.md). As
decisões funcionais aprovadas permanecem documentadas em
[REQUISITOS.txt](REQUISITOS.txt), que é a fonte de verdade do produto.

## Estado aprovado do Bloco A

- Login por e-mail validado, incluindo OTP, persistência de sessão e logout.
- Login com Google validado no ambiente V3 de testes.
- Cadastro, confirmação de maioridade, Termos de Uso, Política de Privacidade e
  respectivos consentimentos validados.
- Importação inicial do legado validada em teste humano.
- O teste humano confirmou **2 rotinas e 2 frascos no aparelho** e **2 rotinas e
  2 frascos na conta**.
- A cópia local foi preservada após a importação; usar a conta nunca autoriza a
  exclusão automática dos dados locais.
- Fluxo Rotina → cadastrar novo frasco → retornar à rotina com o novo frasco
  selecionado, além dos tooltips de Frascos e Rotinas, concluído e aprovado.
- Correção e versionamento do cache do Service Worker concluídos no commit
  `724ba23f0a11c77eff1e9637fd26a9ad21ca026c`, garantindo a atualização do
  `style.css` da V3 sem interferir na V2.9.
- SQL inicial e incremental, RLS, autenticação, OTP e demais testes já aprovados
  não devem ser repetidos sem necessidade objetiva.

## Arquitetura e operação

### Frontend e PWA

O aplicativo é um frontend estático/PWA em HTML, CSS e JavaScript modular, sem
Next.js e sem backend embutido no navegador. `index.html`, `app.js` e
`style.css` mantêm a interface principal; os módulos em `src/` concentram conta,
acesso à nuvem e importação. `manifest.json`, `icon.svg` e `sw.js` compõem a PWA.
O servidor em `scripts/dev-server.mjs` existe somente para desenvolvimento local
e não publica o aplicativo.

### GitHub e GitHub Pages

O GitHub preserva o histórico, as branches de desenvolvimento e os checkpoints.
GitHub Pages hospeda a V2.9 estável em produção. A V3 deve permanecer isolada
durante os Blocos B, C e D; publicar uma branch de testes não equivale a promover
a V3 para produção. `main` e a configuração do GitHub Pages só podem mudar após
validação integral e aprovação final.

### Supabase, Auth e RLS

O projeto isolado `pepday-v3-test` fornece PostgreSQL, autenticação e políticas
Row Level Security. As tabelas vinculam registros ao proprietário e o cliente só
pode acessar o que as políticas e funções aprovadas permitirem. O frontend não é
autoridade para conceder PRO. Mutações de aplicação, movimento, saldo e undo
devem ser transacionais e idempotentes no Bloco B, nunca liberadas por escrita
direta para contornar RLS.

### Login e contas

E-mail/OTP e Google estão validados no ambiente de testes. Redirecionamentos são
limitados ao endereço público aprovado da V3 de testes. Segredos OAuth pertencem
exclusivamente aos painéis dos provedores. O cadastro exige maioridade e aceite
versionado dos Termos de Uso e da Política de Privacidade; nenhum aceite pode ser
presumido ou fabricado.

### Dados locais, importação e futura sincronização

A V2.9 mantém dados no navegador. A importação da V3 cria e confere um snapshot,
preserva identidades/UUIDs, saldos, `done`, `doseHistory` e o registro legado sem
inventar aplicações ou concentrações ausentes. Registros existentes não são
sobrescritos silenciosamente, e a cópia local não é apagada automaticamente.

No Bloco B, a operação será local-first: salvar localmente, registrar operações
pendentes quando offline e sincronizar ao reconectar. Registros editáveis usarão
versão/timestamps para conflitos. Aplicações e movimentos são eventos imutáveis e
não podem adotar uma regra simples de “última escrita vence”. O Perfil deverá
mostrar o estado da sincronização.

### FREE, TRIAL e PRO

A calculadora e o tutorial pertencem ao nível FREE. Recursos como frascos,
rotinas, histórico e sincronização pertencem ao PRO, respeitando o escopo exato
de `REQUISITOS.txt`. As abas continuam visíveis no FREE e apresentam explicação
de acesso. O trial de sete dias só começa por ação explícita do usuário, uma vez
por conta, sem cartão, e não reinicia por instalação, login ou logout. Os gates e
fluxos de FREE/TRIAL/PRO da Fase B1 usam o entitlement calculado no backend. O
cliente não decide acesso pelo relógio ou por `localStorage`; ele apenas consome
os estados `free`, `trial`, `pro_active` e `pro_expired`. No frontend, o estado
gravável fica privado ao módulo autenticado que recebe `get_entitlement()`; eventos
DOM são apenas notificações e não concedem acesso. Navegação e mutações PRO usam
a mesma guarda central, inclusive quando chamadas programaticamente.

A interface mantém Calculadora/tutorial livres sem login, exibe Rotinas e Frascos
no FREE e usa um gate reutilizável para explicar ações PRO. O trial só é solicitado
após clique em “Começar 7 dias grátis”; “Agora não” mantém o FREE. O backend fixa
início e fim com seu próprio relógio, serializa tentativas concorrentes e não
renova um trial já usado. Bloqueio ou expiração nunca exclui dados.
Uma conta que já teve acesso pago e está expirada não recebe trial posteriormente,
mesmo que seu registro ainda indique `trial_used=false`.

### Checkpoint aprovado da B1

- O teste SQL real passou, com rollback confirmado por
  `usuarios_teste_restantes = 0`.
- O teste humano confirmou o estado FREE, o gate PRO em Rotinas, “Agora não”
  mantendo FREE e a Calculadora disponível no FREE.
- O trial foi iniciado explicitamente, sem cartão, e confirmado por sete dias:
  de 11/09/2026 18:08 até 18/09/2026 18:08.
- Rotinas e Frascos foram liberados durante o TRIAL, que persistiu após Ctrl+F5.
- As duas rotinas e os dois frascos permaneceram preservados tanto localmente
  quanto na conta.
- O hardening do gate foi aprovado.
- O ajuste de UX de `+ Nova` Rotina e `+ Novo` Frasco foi concluído no commit
  `9c30f1296d4fc4e5c6c870ec8a1f3042499069f3`. Essa alteração visual será incluída
  na próxima publicação de testes, sem nova publicação Astra isolada, para
  economizar créditos.

### Integrações comerciais e notificações previstas

- **Mercado Pago — não implementado:** arquitetura prevista para pagamento e
  webhooks verificados no backend; somente o backend poderá alterar entitlement.
- **Brevo — não implementado:** arquitetura prevista para e-mails transacionais;
  o serviço não decidirá nem concederá acesso PRO.
- **Firebase/FCM — não implementado:** arquitetura prevista para notificações
  push opcionais, sem expor substância ou dose na tela bloqueada.

Essas integrações pertencem a etapa posterior, conforme `REQUISITOS.txt`. Nenhuma
delas deve ser simulada como pronta ou receber credenciais no frontend.

### Publicação, cache, backup e recuperação

Cada ambiente da PWA deve usar cache versionado e isolado por escopo. O Service
Worker atual invalida o cache anterior da própria V3 e força a carga do CSS atual,
sem remover caches da V2.9 ou de outros escopos. Auth, chamadas de API e URLs com
query string não devem ser armazenadas como assets públicos.

Antes de qualquer promoção, é obrigatório confirmar branch/commit, executar os
testes direcionados ao delta, verificar o ambiente de destino e manter um ponto
de recuperação. O backup íntegro da V2.9 e seus hashes estão em `backup/`; ele
recupera o código estável, não os dados de usuários. Banco e configurações dos
serviços exigem estratégia própria de backup e recuperação antes do lançamento.

### Segurança e LGPD

O PepDay coleta somente dados necessários aos fluxos aprovados e deve aplicar
isolamento por conta, RLS, consentimentos versionados, minimização de dados e
meios adequados de acesso, exportação e exclusão. A revisão jurídica final, o
canal de privacidade e a operação comercial completa continuam pendentes para os
blocos posteriores.

**Nunca armazenar Client Secret, senhas, service-role keys, chaves privadas ou
qualquer credencial confidencial no repositório.** `config.js` contém somente
configuração pública apropriada ao navegador. Segredos ficam nos painéis ou no
backend seguro dos respectivos serviços.

## Escopo imediato: Bloco B

A Fase B1, concluída e aprovada, implementa a fonte única de entitlement, o início idempotente do trial,
o status no Perfil e o gate PRO endurecido de Rotinas/Frascos. As fases seguintes do Bloco B
continuam responsáveis pela integração completa Rotina ↔ Frasco/Calculadora,
aplicações e undo transacionais, sincronização local-first e estados de
sincronização no Perfil. Mercado Pago, Brevo, Firebase e publicação em produção
continuam fora desta fase.

Permanecem deliberadamente para fases futuras: entitlement PRO offline/local-first,
sincronização contínua, avisos de três e um dia para o fim do trial e atualização
automática de campos apenas informativos, como `completed_at`, quando não forem
necessários à autorização.

## Desenvolvimento e testes

- Suite Node: `node --test tests/*.test.mjs`.
- Testes Node somente da B1: `node --test tests/block-b1.test.mjs`.
- Servidor local: `node scripts/dev-server.mjs`.
- SQL B1 em banco efêmero: definir `PGLITE_MODULE` para o `dist/index.js` do
  PGlite 0.5.8 e executar `node scripts/test-b1-sql.mjs`.
- Suite SQL local: `node scripts/test-import-sql.mjs`, com o módulo PGlite
  indicado por `PGLITE_MODULE`; ela usa fixtures descartáveis e não conecta ao
  projeto Supabase.

Executar somente os testes proporcionais à alteração. Não repetir SQL,
autenticação, OTP, sessão, logout ou testes humanos já aprovados sem uma razão
técnica concreta.

## Aviso de uso

O PepDay é uma ferramenta de cálculo e organização de informações inseridas pelo
próprio usuário. Não prescreve, indica ou recomenda substâncias, doses,
tratamentos ou protocolos e não substitui avaliação ou orientação de profissional
habilitado.
