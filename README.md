# PepDay V3.0 — Bloco A / checkpoint A2

**Em desenvolvimento. Não é release candidate nem versão pronta para publicar.**

Base oficial: PepDay_V2.9_Final_Publicada(2).zip. Branch de trabalho:
`v3.0-bloco-a`. A main de produção continua no commit
`25f1d48d34b395be285d35391b6a5b7ebe6d848c`.

## Próximo passo

O projeto Supabase `pepday-v3-test` já responde com a configuração pública
fornecida pelo proprietário. E-mail está habilitado; Google está desabilitado;
profiles ainda não está disponível na API.

**Seguir [docs/CONFIGURAR_TESTES.md](docs/CONFIGURAR_TESTES.md) para aplicar o SQL
pelo painel. Não precisamos de senha, service_role ou secret key.**

O estado completo está em [docs/STATUS.md](docs/STATUS.md).

## Implementado e preparado

- Backup íntegro do ZIP V2.9 e hashes em backup/.
- Estrutura SQL das 11 tabelas aprovadas, UUIDs, vínculos por dono, RLS e grants.
- Inicialização FREE, cadastro, consulta de acesso e trial explícito de sete dias.
- Admin tem acesso PRO próprio, sem leitura global de conteúdo privado.
- SDK oficial Supabase 2.116.0 salvo em vendor/ com origem, hash e licença.
- Perfil integrado a métodos de login, OTP, sessão, logout, cadastro e revisão
  de backup. O fluxo real ainda depende das configurações no painel.
- Snapshot local conferido antes do envio, idempotência e verificação da conta
  esperada no servidor. Nenhum dado local é apagado automaticamente.
- Cache V3.0 separado, somente para assets públicos; Auth/API/query strings fora.
- 21 testes locais passaram; calculadora e tutorial conferidos no navegador.

## Limites deste checkpoint

**Bloco A ainda incompleto.** SQL e RLS reais não foram executados. Não houve
login real, entrega de e-mail, criação de usuário ou publicação.
O formulário não coleta aceite enquanto Termos/Privacidade não tiverem URLs e
versões reais configuradas. Não inventar documentos aceitos.

A migração recebe uma cópia para revisão, mas ainda não converte/mescla dados em
frascos, rotinas e aplicações da nuvem. O histórico V2.9 pode ter eventos apagados
por undo e concentração histórica ausente; não reconstruir por suposição.

As tabelas de domínio permitem somente leitura ao cliente nesta fundação. As
mutações transacionais de saldo/undo, versionamento efetivo e sincronização serão
ligadas no Bloco B. Não abrir escrita direta para contornar essas pendências.

## Onde fica cada parte

| Arquivo/serviço | Função |
| --- | --- |
| index.html, app.js, style.css | Interface existente e calculadora |
| config.js | URL e publishable key públicas do projeto de testes |
| account.css, src/account-ui.mjs | Controles novos do Perfil |
| src/account.mjs, src/cloud.mjs | Integração Auth/conta e validação de configuração |
| src/legacy-import.mjs | Backup e envio do legado para revisão |
| supabase/migrations/ | SQL para o projeto de testes |
| supabase/tests/ | Testes de banco para executar no SQL Editor |
| sw.js | Cache dos arquivos públicos do PWA |
| GitHub Pages | Frontend/PWA, produção V2.9 preservada |
| Supabase | Auth, PostgreSQL, RLS, acesso PRO e futura sincronização |
| Mercado Pago | Pagamentos/webhooks verificados pelo backend, Bloco C |
| Brevo | E-mails transacionais; não decide acesso PRO, Bloco C |
| Firebase/FCM | Push opcional sem substância/dose na tela bloqueada, Bloco C |

Este é um aplicativo estático, não Next.js. Os nomes NEXT_PUBLIC_* enviados
pelo proprietário foram mapeados para config.js; o navegador não lê variáveis
de ambiente do servidor em runtime. Somente configuração pública vai ao frontend.
Credenciais futuras de serviços permanecem no backend/painéis apropriados.

## Desenvolvimento e testes

Com Node instalado: `node --test tests/*.test.mjs`.
Para desenvolvimento local: `node scripts/dev-server.mjs`.
O servidor é apenas uma ferramenta de teste e não publica o aplicativo.

No navegador foram conferidos Perfil sem login, disponibilidade dos métodos,
repetição do tutorial e cálculos mg/mcg nas seringas 30/50/100 UI.
Ainda faltam autenticação real, RLS entre duas contas, mobile, offline/update,
conversão completa da migração e demais testes do prompt mestre.

## Dados, backup e segurança

app.js, style.css, manifest.json e icon.svg permanecem idênticos à V2.9.
index.html e sw.js foram alterados somente na branch de desenvolvimento.
O ZIP em backup/ permite recuperar o código estável; não contém dados dos usuários.
Os dados V2.9 ficam no navegador; o importador mantém uma cópia adicional antes
que o usuário autorize envio. Isso não substitui backup externo do banco.

Não alterar sem revisão: RLS/grants, funções security definer, saldos/histórico,
UUIDs, chaves locais, 5on2off, trial/assinaturas, cache e configuração de projetos.
O frontend nunca é autoridade para liberar PRO. Pagamentos só liberarão acesso
após verificação no backend. Trial nunca começa ao abrir, instalar ou entrar.

## Publicação futura e custos

Não publicar este checkpoint. Primeiro concluir A/B/C/D, validar os testes
obrigatórios, gerar release candidate e receber a aprovação final do proprietário.
Manter backup/commit estável e conferir configuração GitHub Pages antes de promover.

O plano inicial aprovado é Supabase FREE. Conferir limites vigentes no painel;
não foi contratado nenhum recurso pago nesta etapa. Banco, tráfego, envio de
mensagens e exigências de backup podem exigir upgrade conforme o uso. Mercado
Pago, Brevo e Firebase serão configurados no Bloco C, com seus custos conferidos
nessa etapa. Não presumir operação gratuita ilimitada.

## Privacidade e disclaimer aprovado

A revisão jurídica, exportação/exclusão de conta, canal de privacidade e gestão
completa de consentimentos permanecem pendentes antes do lançamento comercial.

“O PepDay é uma ferramenta de cálculo e organização de informações inseridas pelo
próprio usuário. O PepDay não prescreve, indica ou recomenda substâncias, doses,
tratamentos ou protocolos e não substitui avaliação ou orientação de profissional
habilitado. Utilize apenas valores e frequências definidos por você com orientação
profissional adequada.”

## Referências técnicas

- [Chaves públicas](https://supabase.com/docs/guides/getting-started/api-keys)
- [RLS e grants](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Login sem senha](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [SDK oficial](https://supabase.com/docs/reference/javascript/installing)
