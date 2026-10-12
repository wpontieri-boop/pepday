# PepDay — Portal privado do parceiro e convites WhatsApp · Plano de execução seguro

Data: 11/10/2026 · Repo: wpontieri-boop/pepday · Ambiente: TEST exclusivamente · Situação: **FASE 0 TÉCNICA PARCIAL**; **PORTAL/AUTH/ENVIO REAL NÃO IMPLEMENTADOS**.

## Autorização comercial consolidada

Proprietário autorizou executar em TEST o portal do parceiro, convites WhatsApp, lembretes D+2/D+5 e relatórios (relatórios preliminares CSV já LIVE). Exceções aguardam a conversa com contadora na terça-feira 13/10/2026: documentos fiscais por CPF/MEI/CNPJ, retenções e líquidos, competência e datas de pagamento/aviso. A validade jurídica da versão de contrato, política LGPD, coleta e retenção de documentos dependem de revisão jurídica. Não confundir autorização de desenvolvimento com autorização de PROD ou envio real de mensagens.

## FASE 0 — concluída em branch separada

- `src/partner-onboarding-policy.mjs`: funções puras `validPrivateInviteLink`, `makeManualInviteDraft`, `eligibleReminder`, `makeReminderDraft` (nenhuma rede/Storage/RPC/cron). Opera apenas com convite que já teria sido **emitido por backend validado** em URL TEST com token no fragmento; não cria tokens nem autoriza ninguém.
- Exige clique manual explícito para montar mensagem WhatsApp, OWNER/ADMIN com rascunho comercial, consentimento para contato e canal confirmado. Mensagem contém apenas nome público e URL privada, sem CPF/PIX/documentos; oferece opt-out. O link ao parceiro **não pode por si conceder sessão**.
- Lógica condicional D+2 exatos 48h e D+5 exatos 120h após envio inicial registrado: requer convite no estado `pending`, envio inicial confirmado, opt-in, canal confirmado, link ainda válido e ausência de revogação/conclusão/opt-out. Evento `d5` bloqueia posterior D+2; eventos devem ser persistidos com idempotência no backend futuro. **Sem cron nem despacho externo**, sem tarefas agendadas.
- `tests/partner-onboarding-policy.test.mjs` cobre explicit action, papel/consentimento, link de domínio exato, URL pública distinta, formatação sem PII, opt-out, janelas, idempotência, revogação, expiração, contato inválido; ambiente simulado, sem enviar WhatsApp real.
- O link `/parceiros/convite/#invite=<token>` é **formato futuro proposto**, sem rota, documento privado ou token real emitido/publicado. Testes usam token fictício de letras A; nenhum dado de parceiro foi acessado.

## FASE 1 — próxima implementação: contrato técnico/back-end isolado, não liberado

1. Desenhar migration nova, SOMENTE TEST, sem tocar nas tabelas P1/P2 existentes: convites `partner_onboarding_invites` (token imprevisível gerado no backend; guardar apenas SHA-256/expiração/revogação; parceiro e contato pré-cadastrados, ator Admin, status e auditoria), sessões verificadas OTP `partner_onboarding_sessions`, rascunho `partner_onboarding_submissions` sem gravação direta em `partner_private_profiles`, eventos de envio/opt-out `partner_onboarding_events`. RLS privada: nenhum acesso público a tabela, grants mínimos a RPCs validadas. Evitar dados brutos pessoais em tabelas de eventos.
2. OWNER/ADMIN autorizado gera convite no rascunho após conferir o contato; **Salvar rascunho NUNCA envia**. URL/token só retornam uma vez ao operador para compartilhar manualmente; link expirado/revogado só reemitido com revogação do anterior. Não usar QR público `/cartao/?ref=...` como identidade.
3. Parceiro autentica posse do contato registrado por OTP com origem e tentativas limitadas, rate-limit e erros indistinguíveis (sem enumeração); sessão própria distinta do Admin e do cliente PepDay, identidade vinculada no backend ao `partner_id`; o token sozinho **não basta**. Nenhuma PII antes de verificação.
4. Portal responsivo só pode salvar uma **solicitação** de atualização de dados/PIX em rascunho, **nunca sobrescrever P1, percentual ou ativar**. OWNER revisa e usa guards de step-up existentes quando ação alterar P1; alterações de contrato/PIX precisam de nova revisão.
5. Contrato versionado e texto exato **revisado juridicamente** antes de mostrar botão de aceite; guardar hash do texto, versão, data servidor e usuário autenticado, finalidade. Não fingir que checkbox equivale automaticamente a assinatura qualificada.
6. Documentos com matriz configurável dependente da contadora; upload apenas por grants específicos para parceiro autenticado, bucket privado TEST distinto ou política isolada, MIME real e extensão assinada PDF/PNG/JPEG até 5 MiB, hash SHA-256, sem URL pública, antivírus/quarentena quando cabível. Não relaxar bucket `partner-documents` nem reaproveitar OWNER grant indevidamente. Não exigir selfie/RG/CCMEI/nota antecipadamente sem decisão contábil/jurídica.
7. Lembretes WhatsApp D+2/D+5: JOB futuro apenas lê elegibilidade condicional, fila idempotente, opt-out e reemissão segura; integração Business API/templates requer canal e autorização próprios. **Nenhum envio real até aprovação operacional**, e nenhum lembrete fiscal de `fechamento-10dias` até parecer.
8. QA: migration/testes com dados sintéticos isolados e rollback, negar acesso A/B, token vencido, tentativas OTP, upload inválido/PII, replay/duplo envio, papel OWNER/ADMIN/VIEWER, invariantes P1/P2, não repetir PASS antigos, sem PROD.
9. Documentar RESULTADOS em CURRENT-STATE com data/ambiente/commit/Render/Supabase não secreto e evidências. Revisor independente de segurança/LGPD/contrato e homologação humana dos fluxos novos antes de sequer propor publicação PROD.

## Bloqueios e próxima ação explícita

**Bloqueado (não concluído):** backend hash + OTP e portal, contrato juridicamente revisado, upload seguro sob matriz contábil, WhatsApp Business e envios, cron e mensageria, homologação humana. Isto NÃO impede escrever e testar a base técnica em TEST.

**Próxima ação:** implementar migration/backend OTP + portal isolado em nova fase TEST com revisão de segurança e negativos de RLS, depois conectar manual-share WhatsApp e lembretes condicionalmente; só pedir à contadora, em 13/10, as decisões contábeis/fiscais. Não promover ou enviar nada real sem autorização.
