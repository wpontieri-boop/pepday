# PepDay V3.0 — checkpoint do Bloco A

**Em desenvolvimento. Não é release candidate nem versão pronta para publicar.**

Base: `PepDay_V2.9_Final_Publicada(2).zip`, enviada pelo proprietário.
Os seis arquivos de interface são idênticos aos da `main` no commit
`25f1d48d34b395be285d35391b6a5b7ebe6d848c`. A branch de trabalho é
`v3.0-bloco-a`. Não houve alteração ou publicação na `main`.

## O que já existe neste checkpoint

- Backup do ZIP estável e SHA-256 por arquivo em `backup/`.
- Migração SQL das 11 tabelas aprovadas, UUIDs, vínculos por usuário,
  preparação/concentração, versionamento e estrutura de histórico.
- RLS e permissões explícitas. Cada conta consulta somente os próprios dados;
  o papel `admin` não possui leitura global.
- Inicialização de conta FREE; cadastro com maioridade e aceites separados de marketing.
- Funções de consulta de acesso e início explícito de trial de sete dias.
  A operação de início usa bloqueio de linha para não reiniciar o trial.
- Adaptador de autenticação Google/e-mail/OTP, sessão, logout e cadastro em `src/account.mjs`.
  Recebe uma instância do SDK oficial; o SDK e a conexão real ainda não foram instalados/configurados.
- Snapshot local, hash, backup conferido e envio idempotente para área privada de
  revisão em `src/legacy-import.mjs`. Não apaga dados locais nem marca o envio
  como migração concluída.
- 13 testes Node executados com sucesso; roteiro SQL de isolamento preparado.

## O que ainda não está concluído

**Bloco A não está concluído.** A fundação foi preparada; a conexão e validação
real estão bloqueadas pela configuração humana do projeto Supabase, conforme
o item 17 do prompt mestre. O SQL não foi aplicado nem executado neste ambiente,
que não tem PostgreSQL, Supabase CLI ou Docker disponíveis.

O adaptador de conta não está ligado à interface e não há login funcionando
neste pacote. O `index.html`, visual, calculadora, tutorial e service worker
continuam V2.9. Abrir o pacote não demonstra a V3.0.

A migração recebe e verifica o snapshot, mas ainda não converte os registros em
frascos, rotinas e aplicações da conta. Precisa de revisão do legado, resolução
de colisões e confirmação do usuário quando já existirem dados na nuvem.
Históricos antigos podem não ter concentração original ou eventos apagados por
undo; esses dados não podem ser reconstruídos por suposição.

As tabelas de domínio têm somente leitura para clientes nesta etapa. As mutações
transacionais, dedução/undo, versionamento efetivo, sincronização local-first e
resolução de conflitos serão conectadas no Bloco B. Não abrir permissões de
escrita direta para fazer a interface funcionar.

## Configuração humana necessária agora

1. Criar ou identificar um projeto Supabase de **homologação** do PepDay.
2. Obter a URL do projeto e sua chave **publishable** (pública).
   Preencher uma cópia local de `config.example.json` chamada `config.local.json`.
   Nenhum valor foi inventado ou incluído neste checkpoint.
3. Guardar a senha do banco no gerenciador de senhas do proprietário. Não enviar
   senha, service-role key ou secret key por chat e não colocar no repositório.
4. Configurar autenticação por e-mail e URLs exatas de retorno do ambiente de
   testes. Para OTP, configurar o template de e-mail para incluir o token de seis
   dígitos. Para Google, configurar o provedor no painel Supabase e guardar o
   segredo OAuth somente nesse painel.
5. Aplicar `supabase/migrations/202609090001_block_a.sql` uma vez no banco de testes
   e executar `supabase/tests/block_a.sql`. O teste roda dentro de transação e faz
   rollback; usa contas fictícias reservadas ao teste.
6. Após login e cadastro reais, identificar o UUID da conta administrativa.
   A promoção é uma operação do backend/SQL Editor: ajustar `profiles.role` para
   `admin` e `subscriptions.access_override` para `admin` na mesma transação,
   somente para esse UUID. Registrar `admin_access_granted` em `audit_logs`.
   Não criar botão ou RPC pública de promoção e não usar o e-mail como regra automática.

Depois dessas configurações: instalar e fixar a versão do SDK oficial, ligar a
interface de conta no Perfil, validar Google/e-mail/logout, concluir e testar a
migração e executar testes reais com duas contas antes de encerrar o Bloco A.

## Serviços do projeto

| Serviço | Responsabilidade | Estado neste checkpoint |
| --- | --- | --- |
| GitHub Pages | Frontend e PWA | V2.9 preservada |
| Supabase | Auth, banco, RLS, sincronização e acesso PRO | Fundação SQL; projeto não conectado |
| Google/e-mail | Métodos de login via Supabase | Adaptador preparado; integração pendente |
| Mercado Pago | Cobrança e webhooks verificados pelo backend | Bloco C |
| Brevo | E-mails transacionais; não decide acesso PRO | Bloco C |
| Firebase/FCM | Push opcional sem informações sensíveis | Bloco C |

O plano previsto para começar é Supabase FREE; verificar os limites vigentes no
painel antes da ativação. Os demais custos e limites devem ser conferidos na
configuração de cada serviço. Não há assinatura ou recurso pago contratado por
este checkpoint. Crescimento de banco, tráfego, mensagens ou exigências de backup
pode demandar mudança de plano; não há garantia de operação gratuita ilimitada.

## Validação local e preservação da base

Com Node instalado: `node --test tests/block-a.test.mjs`.
Verificação de sintaxe: `node --check app.js`, `node --check sw.js` e
`node --check src/account.mjs`, `node --check src/legacy-import.mjs`.
O relatório detalhado está em `docs/STATUS.md`.

O ZIP de segurança em `backup/` é do aplicativo, não dos dados dos usuários.
Dados da V2.9 ficam no navegador. O importador cria uma cópia local adicional
antes de enviar; não confundir isso com backup externo do banco.

## Publicação e atualização futuras

Não publicar este checkpoint. Para promover uma V3.0 futura: concluir os quatro
blocos, executar todos os testes do prompt mestre, gerar release candidate,
obter aprovação final do proprietário e somente então substituir produção.
Antes disso, revisar configuração do GitHub Pages e manter possibilidade de
retorno ao commit estável. Não mudar a branch de publicação agora.

O service worker V3.0 deve receber cache próprio, servir apenas assets públicos
do app e não cachear respostas Auth/banco. Nesta etapa ele permanece V2.9 para
preservação byte a byte. O mecanismo de atualização será validado no Bloco D.

Não alterar sem revisão: RLS, grants, funções security definer, saldos/histórico,
UUIDs, chaves de armazenamento local, `5on2off`, trial/assinaturas, cache e
credenciais. O frontend nunca é autoridade para conceder PRO.

## Privacidade e texto aprovado

Termos e Política finais ainda serão revisados antes do lançamento comercial.
Exportação/exclusão de conta, canal de privacidade e consentimentos destacados
pertencem aos fluxos ainda pendentes. Não tratar este checkpoint como conformidade
jurídica validada.

Texto a manter na V3.0:

“O PepDay é uma ferramenta de cálculo e organização de informações inseridas pelo
próprio usuário. O PepDay não prescreve, indica ou recomenda substâncias, doses,
tratamentos ou protocolos e não substitui avaliação ou orientação de profissional
habilitado. Utilize apenas valores e frequências definidos por você com orientação
profissional adequada.”

## Referências técnicas consultadas

- [RLS e permissões Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Login sem senha](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [SDK: signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
- [SDK: Google/OAuth](https://supabase.com/docs/reference/javascript/auth-signinwithoauth)
- [SDK: logout](https://supabase.com/docs/reference/javascript/auth-signout)
