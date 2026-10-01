# PepDay V3.0 — Manual do Projeto

O PepDay é uma ferramenta de cálculo matemático e organização de informações inseridas pelo próprio usuário. Ele **não prescreve, indica ou recomenda substâncias, doses, tratamentos ou protocolos** e não substitui orientação de profissional habilitado.

Este README é o manual operacional do proprietário. As decisões funcionais completas ficam em [REQUISITOS.txt](REQUISITOS.txt) e o histórico técnico detalhado em [docs/STATUS.md](docs/STATUS.md).

## 1. Regra principal de segurança

A **V2.9 continua sendo a produção estável**. A V3 está em desenvolvimento e homologação.

Até aprovação final:

- não alterar ou promover `main` sem autorização expressa;
- não substituir a V2.9 em produção;
- não mudar GitHub Pages para a V3;
- não inserir credenciais no frontend ou no Git;
- não aplicar migrations da V3 em banco de produção;
- não ativar cobrança, e-mail ou push com credenciais reais sem validar primeiro no ambiente de teste.

A branch de desenvolvimento atual é:

```
v3.0-bloco-b
```

## 2. Ambientes

### Produção estável

A produção ainda é a **V2.9**, hospedada separadamente. Ela deve permanecer intacta até a liberação formal da V3.

### Homologação pública da V3

Frontend público de teste:

```
https://homologacao.pepday.com.br/
```

Landing principal:

```
https://homologacao.pepday.com.br/site/
```

Landing do cartão/QR:

```
https://homologacao.pepday.com.br/cartao/
```

Painel administrativo:

```
https://homologacao.pepday.com.br/site/admin/
```

O Render publica automaticamente a branch `v3.0-bloco-b` da homologação. Isso **não** equivale a publicar a V3 em produção.

### Supabase de teste

Projeto isolado:

```
pepday-v3-test
```

O projeto de teste concentra Auth, PostgreSQL, RLS, RPCs e Edge Functions da V3. Produção não deve receber migrations da V3 sem aprovação final.

## 3. Como o PepDay está dividido

### Frontend / PWA

Arquivos principais:

- `index.html` — aplicação;
- `app.js` — interface e fluxo local;
- `style.css` e `account.css` — estilos;
- `src/` — módulos de conta, acesso, sincronização, repositório local e regras auxiliares;
- `manifest.json` — configuração PWA;
- `sw.js` — Service Worker e cache;
- `config.js` — **somente configurações públicas**;
- `termos.html` e `privacidade.html` — documentos jurídicos vigentes da homologação.

O app é local-first: grava no IndexedDB do dispositivo e sincroniza a conta quando possível.

### Marketing

- `site/` — landing principal clara/premium;
- `cartao/` — landing curta do QR físico;
- `site/admin/` — painel privado de aquisição.

O app interno continua em tema dark premium. A landing comercial usa tema claro.

## 4. GitHub

Repositório:

```
wpontieri-boop/pepday
```

O GitHub é o ponto central para continuar o projeto entre o PC da loja e o Mac.

Fluxo obrigatório:

1. antes de começar, ler `AGENTS.md`;
2. executar `git fetch origin`;
3. conferir branch e `git status`;
4. comparar divergência local/remoto;
5. só usar `pull --ff-only` quando não houver trabalho local divergente;
6. desenvolver e testar;
7. revisar secrets/arquivos indevidos;
8. commit;
9. push;
10. confirmar divergência `0 0`.

Nunca sobrescrever mudanças de outro computador sem comparar primeiro.

## 5. Supabase — login, banco, sincronização e entitlement

O Supabase é a autoridade da conta.

Responsabilidades:

- login por e-mail/OTP;
- Google quando habilitado;
- perfis e consentimentos;
- banco da conta;
- FREE / TRIAL / PRO;
- sincronização;
- rotinas, frascos, aplicações e movimentos confirmados;
- billing state;
- atribuição de aquisição;
- exportação de dados;
- exclusão de conta via backend;
- Edge Functions.

### RLS e segurança

O navegador não recebe chave administrativa.

Dados de usuário são protegidos por RLS, RPCs e funções que usam o usuário autenticado. Operações críticas de domínio são transacionais e versionadas.

Tabelas internas como filas de billing, e-mail e push não têm leitura direta pelo cliente. O acesso ocorre somente pelas RPCs/backend previstos.

### Configuração pública

`config.js` pode conter somente dados adequados ao navegador, como URL do projeto, publishable key, versões jurídicas e URLs públicas.

Nunca colocar em `config.js`:

- secret key;
- service-role key;
- senha;
- private key;
- access token;
- webhook secret;
- Client Secret OAuth.

## 6. Login: Google e e-mail

E-mail/OTP usa Supabase Auth.

Google depende do provedor Google configurado no Supabase e dos redirects autorizados. Os redirects de autenticação não devem ser trocados casualmente ao mudar uma landing ou URL jurídica.

Termos e Privacidade são versionados. O cadastro só é considerado juridicamente atual quando:

- maioridade está confirmada;
- Termos foram aceitos;
- Política foi aceita;
- `terms_version` coincide com `config.termsVersion`;
- `privacy_version` coincide com `config.privacyVersion`.

Quando uma nova versão é publicada, dados existentes são preservados e o Perfil solicita novo aceite.

## 7. Dados locais e sincronização

O armazenamento local principal é IndexedDB.

Stores atuais:

- `vials`;
- `routines`;
- `routineVersions`;
- `applications`;
- `vialMovements`;
- `outbox`;
- `conflicts`;
- `drafts`;
- `meta`;
- `migrationReceipts`.

A sincronização é local-first:

1. ação é salva localmente;
2. uma operação entra na outbox quando necessário;
3. o backend valida e confirma;
4. conflitos não são sobrescritos silenciosamente;
5. usuário pode revisar conflito quando a regra permitir.

Aplicações e movimentos mantêm histórico imutável/versionado.

O botão **Apagar meus dados locais** remove apenas o escopo ativo daquele dispositivo. Ele não equivale à exclusão da conta.

## 8. FREE, TRIAL e PRO

### FREE

- calculadora;
- tutorial;
- uso básico sem exigir conta para a calculadora.

### TRIAL

- 7 dias;
- só começa por ação explícita;
- uma vez por conta;
- sem iniciar automaticamente em login, instalação ou reload.

### PRO

Preço comercial aprovado para a V3:

- mensal: **R$ 14,90/mês**;
- anual: **R$ 99,90/ano**;
- anual: “Mais vantajoso”;
- economia exibida: **R$ 78,90 por ano**.

Recursos PRO incluem rotinas, frascos, histórico, previsão de término, alertas e sincronização conforme o escopo aprovado.

Fim de trial ou assinatura **não apaga dados**. O acesso pode ser bloqueado e restaurado depois.

### Códigos promocionais PRO

A homologação também suporta acesso PRO temporário por código promocional, separado de billing:

- presets administrativos: **AMIGO30**, **AMIGO60** e **AMIGO90**;
- duração de 30, 60 ou 90 dias;
- limite de usos e data de validade configuráveis;
- uso de código promocional limitado a uma vez por conta;
- código pode ser exclusivo para uma conta já cadastrada;
- resgate registra conta, horário de resgate, início e fim do acesso;
- admin pode ativar/desativar e consultar resgates;
- se o código for aplicado durante um trial ativo, o período promocional começa após o fim do trial;
- assinatura paga ativa não aceita novo resgate promocional.

Código promocional **não cria pagamento, receita ou conversão paga** e não grava evento financeiro do Mercado Pago. O entitlement identifica essa origem como `promo`.

## 9. Mercado Pago — pagamentos

O Mercado Pago é o gateway inicial previsto para assinatura PRO.

Arquivos:

- `supabase/functions/mercado-pago-checkout/`;
- `supabase/functions/mercado-pago-webhook/`;
- migrations de billing em `supabase/migrations/`.

Regras:

- redirect do navegador nunca concede PRO;
- somente backend/webhook confirmado altera entitlement;
- webhook valida assinatura;
- pagamento aprovado, pendente, rejeitado, renovação, cancelamento, tolerância e expiração têm estados próprios;
- falha de renovação usa tolerância de 3 dias;
- cancelamento mantém acesso até o fim do período pago quando aplicável;
- exclusão da conta tenta cancelar uma preapproval ativa antes de remover a conta.

### Variáveis de ambiente Mercado Pago

Ficam no backend/Supabase Edge Functions, nunca no Git:

- `MERCADO_PAGO_ACCESS_TOKEN`;
- `MERCADO_PAGO_WEBHOOK_SECRET`;
- `MERCADO_PAGO_MONTHLY_PLAN_ID`;
- `MERCADO_PAGO_ANNUAL_PLAN_ID`;
- `MERCADO_PAGO_LIVE_MODE`;
- `PEPDAY_BILLING_RETURN_URL`.

A fundação está pronta em código/banco, mas a ativação comercial depende de credenciais e planos reais validados.

## 10. Brevo — e-mails transacionais

Arquivos:

- `supabase/functions/brevo-email-worker/`;
- migrations `block_c_brevo_email_*`.

O outbox de e-mail é backend-only, idempotente e não armazena o endereço de e-mail como payload de fila. O destinatário é resolvido no backend no momento do envio.

Eventos previstos incluem criação de conta, trial, pagamento, renovação, falha, cancelamento, reativação e segurança.

### Variáveis Brevo

Somente backend:

- `BREVO_API_KEY`;
- `PEPDAY_EMAIL_WORKER_SECRET`;
- `PEPDAY_PUBLIC_URL`;
- `BREVO_TEMPLATE_<EVENTO>` para cada template transacional usado.

No ambiente TEST, chave, remetente, templates e worker já foram configurados e um envio transacional real foi validado com `provider_message_id`. Produção continua separada e exige revisão do remetente/domínio definitivo.

Brevo apenas envia mensagens. Ele não concede PRO.

## 11. Firebase / FCM — push

Arquivos:

- `supabase/functions/fcm-push-worker/`;
- `supabase/functions/fcm-push-cron-dispatcher/`;
- migration `block_c_fcm_push_foundation`;
- migrations de dispatcher periódico `fcm_push_cron_dispatcher` e `route_fcm_cron_dispatcher`.

Tipos de push:

- rotina do dia;
- reposição;
- avisos operacionais;
- segurança da conta.

Todas as categorias respeitam preferência do usuário.

A mensagem da tela bloqueada é fixa e genérica. Nunca deve incluir:

- substância;
- dose;
- histórico;
- detalhes sensíveis.

### Variáveis FCM

Somente backend:

- `FIREBASE_SERVICE_ACCOUNT_JSON`;
- `PEPDAY_PUSH_WORKER_SECRET`;
- `PEPDAY_PUBLIC_URL`.

A service account contém chave privada e **jamais** deve entrar no repositório.

No ambiente TEST, a service account e o segredo do worker já estão configurados somente no backend. O processamento automático usa `pg_cron` + `pg_net` e um dispatcher interno com token efêmero de uso único; nenhum segredo estático do worker é gravado no banco ou no Git. Quatro smokes reais foram aceitos pelo Firebase e persistiram `provider_message_id`; o quarto foi exibido fisicamente no Mac com o PepDay fechado após habilitar as notificações do Google Chrome no macOS. Push de homologação: **PASS final**.

## 12. Admin interno

O painel privado está em `/site/admin/`.

O acesso exige:

- conta autenticada;
- `profiles.role='admin'`.

As métricas comerciais do painel são agregadas:

- novas contas;
- contas atribuídas ao cartão/QR;
- outras origens;
- trials;
- conversões pagas;
- PRO pagos ativos;
- taxas cartão → trial e cartão → PRO.

A área administrativa de códigos promocionais é uma exceção operacional controlada: para criar código exclusivo e conferir quem resgatou, ela pode mostrar ao admin nome/e-mail e identificador da conta estritamente necessários a essa gestão. Rotinas, frascos, doses e demais dados de saúde não são exibidos.

“Cartão/QR” significa **conta atribuída ao cartão**, não scan anônimo.

## 13. LGPD, Termos e Privacidade

Documentos:

- `termos.html`;
- `privacidade.html`.

Versões atuais da homologação:

- `terms-2026-09-28`;
- `privacy-2026-09-28`.

O Perfil oferece:

- exportação JSON dos dados confirmados na conta;
- exclusão de conta com confirmação `EXCLUIR`;
- exclusão local separada.

A exportação não inclui segredos, tokens, outboxes internos ou logs técnicos internos.

A exclusão de conta é executada pela Edge Function `account-delete`. A conta e dados associados são removidos por backend/cascata somente depois das validações necessárias.

**A revisão jurídica final por profissional competente continua obrigatória antes do lançamento comercial.**

## 14. Onde ficam as variáveis de ambiente

Segredos de serviços ficam nas configurações das Edge Functions/ambiente seguro do Supabase ou no painel do provedor correspondente.

Não criar `.env` versionado.

Antes de commit:

```
git diff --check
git status
```

Também fazer busca de valores secretos e arquivos inesperados.

Nomes de variáveis podem existir no código/documentação; **valores reais nunca**.

## 15. Publicação

### Homologação

O Render está ligado à branch `v3.0-bloco-b`.

Fluxo:

1. testes passam;
2. commit;
3. push da branch;
4. Render faz auto-deploy;
5. conferir deploy `LIVE`;
6. smoke externo das URLs afetadas.

### Supabase

Migrations são aplicadas explicitamente somente ao projeto correto. Nunca reaplicar uma migration já registrada com outro conteúdo.

Edge Functions são implantadas explicitamente.

### Produção

Publicação da V3 em produção só acontece após:

- testes obrigatórios;
- validação mobile;
- validação PWA/cache;
- integrações comerciais configuradas quando necessárias;
- revisão jurídica final;
- release candidate aprovado;
- autorização expressa do proprietário.

## 16. Atualização do PWA e cache

O Service Worker usa cache versionado e isolado por escopo.

Ao alterar assets públicos importantes:

1. atualizar o conteúdo;
2. incrementar a versão do cache em `sw.js`;
3. rodar testes;
4. validar reload/atualização;
5. não remover cache da V2.9.

Auth, APIs, conteúdo privado e requests com Authorization não entram no cache público.

## 17. Backup e recuperação

### Código

A principal proteção é Git + GitHub.

Ao terminar uma sessão de desenvolvimento:

- revisar;
- testar;
- commit;
- push;
- confirmar `HEAD == origin/v3.0-bloco-b`.

Antes de trocar de computador, sempre subir o checkpoint.

### Banco e serviços

Git não é backup de banco.

Antes de produção, manter estratégia própria para:

- Supabase/PostgreSQL;
- configurações Auth;
- Edge Functions;
- Mercado Pago;
- templates Brevo;
- Firebase;
- domínios/redirects.

Nunca colocar backup com credenciais no repositório.

### Dados locais

Dados ainda não sincronizados podem existir apenas no dispositivo. Não formatar, limpar navegador ou apagar IndexedDB de um dispositivo de teste sem confirmar a sincronização ou exportar o que for necessário.

## 18. Custos e upgrades

A arquitetura foi montada para começar pequena e aproveitar planos gratuitos ou de baixo custo **quando o provedor e a conta permitirem**. Preços, franquias e disponibilidade mudam e devem ser conferidos no dashboard oficial antes do lançamento.

Em geral, upgrades podem se tornar necessários por:

- volume de banco/storage;
- número de usuários/Auth;
- volume de Edge Functions;
- tráfego/banda;
- número de e-mails;
- número de pushes;
- recursos de backup/observabilidade;
- necessidades de SLA;
- volume de pagamentos e taxas transacionais.

Nunca assumir que um plano continua gratuito apenas porque era gratuito durante a homologação.

## 19. Testes

Suite completa:

```bash
npm test
```

Testes específicos podem ser executados com:

```bash
node --test tests/<arquivo>.test.mjs
```

Servidor local:

```bash
node scripts/dev-server.mjs --port 4173
```

Executar testes proporcionais ao delta. Não repetir testes humanos, SQL pesado ou fluxos já aprovados sem motivo técnico.

## 20. Estado atual por bloco

### Bloco A — base

Concluído: Supabase, Auth, banco, RLS, migração inicial e base de conta.

### Bloco B — produto e sincronização

Concluído na fundação funcional: FREE/TRIAL/PRO, relação Rotina ↔ Frasco, local-first, outbox, conflitos, Perfil e operações transacionais.

### Bloco C — comercial e notificações

Fundação concluída:

- billing Mercado Pago;
- webhook e checkout;
- estados comerciais;
- Brevo outbox/worker;
- FCM preferências/outbox/worker;
- landing comercial;
- aquisição cartão/QR;
- painel admin;
- códigos promocionais PRO de 30/60/90 dias, separados de billing.

Na homologação TEST, Mercado Pago sandbox, Brevo e FCM já tiveram fluxos reais validados. O push FCM possui pipeline automático seguro e confirmação visual física no Mac. Produção continua sem ativação automática e depende das credenciais/configurações finais e aprovação expressa.

### Bloco D — finalização

Em andamento:

- LGPD/Termos: fundação implementada;
- exportação/exclusão: implementadas em homologação;
- README/manual: atualizado;
- PWA/cache: atualizado e ainda requer validação final;
- testes finais: em andamento;
- validação mobile: pendente;
- ZIP/release candidate: pendente;
- revisão jurídica profissional: pendente.

## 21. O que NÃO alterar sem cuidado

- `main` e GitHub Pages;
- V2.9;
- migrations já aplicadas;
- políticas RLS;
- RPCs transacionais;
- regras de entitlement;
- cálculo matemático aprovado;
- versionamento de rotinas/frascos;
- cache da V2.9;
- URLs de Auth/redirect;
- planos e IDs do Mercado Pago;
- credenciais de provedores;
- versões de Termos/Privacidade sem atualizar o fluxo de aceite;
- regras de exclusão e cascata;
- service workers;
- domínio final/QR físico.

Quando houver dúvida, criar checkpoint antes da alteração.

## 22. Regra para continuar em outro computador

No computador atual:

```bash
git status
git fetch origin
git rev-list --left-right --count HEAD...origin/v3.0-bloco-b
git push origin v3.0-bloco-b
```

No computador seguinte:

```bash
git fetch origin
git status
git rev-list --left-right --count HEAD...origin/v3.0-bloco-b
git pull --ff-only origin v3.0-bloco-b
```

Só usar o `pull --ff-only` se não houver mudança local divergente.

---

Para o estado técnico exato da última sessão, consulte [docs/STATUS.md](docs/STATUS.md).
Para o checklist de liberação e bloqueios atuais, consulte [docs/RELEASE-CANDIDATE.md](docs/RELEASE-CANDIDATE.md).
