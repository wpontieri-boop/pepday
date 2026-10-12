# PepDay preparação persistente WhatsApp e monitor TEST
Data: 12/10/2026. Branch v3.0-bloco-b. Base eb514d7. Exclusivamente TEST.

## Entrega e limites
Nova migration 20261012163141_partner_whatsapp_persistence_test.sql aplicada UMA vez em TEST fsbqpyyprtymwrmzsacp via CLI Management API. História registrada e conteúdo conferido MD5 ca27859fbbc2b7bd25a0dd1f5676e60f, igual ao arquivo local. As duas tentativas MCP anteriores falharam Invalid or expired requestState e foram confirmadas sem schema criado; não reaplicar. Um erro de serialização do texto da história foi corrigido e conferido; DDL efetivo estava correto e não foi reaplicado.

Schema privado partner_whatsapp: config, contatos QA sem telefone, bindings de convite, outbox, receipts por hash e auditoria. Todas as tabelas RLS, sem grants/schema USAGE para anon/authenticated/service_role. RPC de ingestão service_role apenas, transação atômica dedupe+efeitos; RPC Admin OWNER/AAL2/sessão válida existente. Search path vazio. Não modificar RPCs P1/P2/P3 ou autenticação.

Config nasce disabled; CHECK impede real_send, real_collection ou central_enabled. OWNER pode preparar somente test_synthetic e simulação explícita via RPC; nenhum dispatcher real/Graph API/LLM/cron. Envio/resposta a parceiros, Central IA e coleta reais não podem ser ativados nessa versão.

## Fluxos sintéticos preparados
- Contato é rótulo QA-CONTACT, nunca E.164 real. Binding exclusivo por parceiro/convite; opt-in de teste qa-contact-v1. Reemissão não remove supressão do mesmo contato.
- sync_queue integra a outbox às mensagens pending existentes do portal, sem duplicação (invite_id/kind). simulate exige confirmação e consome uma entrada queued uma vez, retornando referência QA. Não representa envio Meta.
- Ingress persistente verifica HMAC/canal/formato de todo o payload antes de fazer UMA RPC. Nenhum raw body, mensagem livre, mídia, número, token ou OTP é persistido; logs não recebem valores sensíveis.
- PARAR/SAIR/CANCELAR só produz opt_out interno se mapeamento confiável do servidor reconhecer o contato. Banco suprime contatos, cancela mensagens pending e outbox queued de D2/D5, revoga sessões e registra auditoria uma vez. Demais mensagens são drop, nunca resposta/IA/encaminhamento ao OWNER.
- Status sent/delivered/read/failed só correlaciona referências da outbox sintética por hash; atraso não rebaixa delivered para sent/failed, read/failed não provoca reenvio. Evento desconhecido não cria envio. Banco recusa colisão de event_hash com outro fingerprint. ACK só após commit; falha de banco não é ACK de sucesso.
- Revogação, conclusão e opt-out do portal cancelam novas filas via trigger aditivo. Nenhum dado P1/P2 é sobrescrito.
- Edge meta-whatsapp-gateway v1 ACTIVE, verify_jwt=false por autenticação HMAC própria e RPC service-only; ambiente exato TEST. GET/POST atuais HTTP503 disabled. Sem configuração Meta criada. Mapa de contatos vazio na entrada publicada; mock de mapeamento é teste unitário, não integração real.
- Template catalog initial/d2/d5/otp_auth em pt_BR é rascunho para futura submissão Meta, categoria PROPOSTA e approval pending_meta. Suporte/número/WABA e componentes oficiais de autenticação ainda dependem de validação externa; não afirmar aprovado.
- src/partner-real-readiness.mjs prepara análise offline de CPF/MEI/CNPJ reutilizando validation.mjs, formato de PIX, allowlist de campos e preflight size/MIME/magic. Não retorna dados pessoais, nem grava cadastro. Checksum não confirma identidade/representação. Arquivos continuam uploadEnabled=false, quarantine/malwareScan obrigatórios; não existe integração antivírus real ou aceite final.
- Admin /admin/parceiros/portal/: nova consulta somente leitura Consultar estados de mensagens. Exibe modo/filas/falhas/auditoria sem contact label/token/delivery hash. Limpa em logout/pagehide/visibilitychange, descarta resposta antiga. OWNER apenas. Sem botões de ativação real.

## Evidências
- SQL real completo de criação+assertions em transação com ROLLBACK antes da instalação: PASS_WHATSAPP_PERSISTENCE_ROLLBACK. Após instalar, supabase/tests/partner_whatsapp_assertions.sql também PASS/ROLLBACK. Grants/RLS, modo real negado, cross-bind, dedupe, confirmação/replay, atraso de status, colisão, batch parcialmente inválido com rollback integral, opt-out A sem tocar B, cancelamento D2/D5 e reemissão suprimida, AAL1 recusado.
- Novos 19 testes (11 ingress + 8 readiness/templates); focais gateway/readiness 46/46 PASS; suíte serial 584/584 PASS (0 falha/skip). Build TEST, sintaxe e diff-check PASS. Logs test-output/whatsapp-persistence-final-regression.log.
- Browser automatizado Chromium 141/Playwright 1.56.1 em 390x844 e 1280x900: monitor de falha simulada, fluxos novos/roles e regressão diretamente afetada PASS, sem chamadas reais Auth/RPC/provider; ADMIN/VIEWER negados. Não é PASS humano. Dependências isoladas em /private/tmp/pepday-qa-tools, fora do Git. Tentativa inicial com caminho Chrome inexistente falhou e foi corrigida usando Chromium de QA.
- Integridade após rollback: 17 users/2 partners, zero convites/contatos/outbox/receipts QA permanentes, mode disabled e real_send false. Parceiros digest 8cba834efdf511594518a5551346cb33; funções protegidas public/partner_portal c050cf375545d24eccdc07b04d0e1abd idênticas excluindo as duas RPCs novas.
- Advisors security: 0ERROR; 54 INFO RLS sem policy, privadas/revoked; 1 WARN anon DEFINER antigo, 60 authenticated DEFINER (nova OWNER guardada), 1 leaked password protection do plano. Performance sem nova FK sem índice; INFO unused contacts_partner_id esperado antes de uso.
- GitHub secret scanning: alertas 1/2/3 google_api_key RESOLVED/wont_fix. Não é prova de rotação ou de restrições corretas de chave Google; revisar restrições/dependências antes de real, sem alterar PROD automaticamente.
- Ajuda helpVersion 2026-10-12; Word v1.4 editado preservando Drive ID 1PYLoYSgRIs-b19i0Bz4HSPIqtnNK-wYm e identidade existente do documento, seis páginas renderizadas/inspecionadas. Não pedir reteste humano da Ajuda/login/P1/P2/P3/PDF.

## Pendências externas e próxima ação
A. Número WhatsApp único, WABA/Phone ID/conta Meta/templates/consentimento/canal de suporte externo.
B. Contadora 13/10: matriz CPF/MEI/CNPJ, retenções, competência, calendário e guarda sem hipóteses.
C. Advogado: contrato final, representação e aviso LGPD/consentimentos definitivos.
D. Segurança para dados reais: restrições/alertas Google, origem confiável de rate-limit IP da Edge portal, pentest proporcional, antimalware/quarentena e validação de contato/identidade com canal real. Não alegar revisão independente concluída.
E. Homologação humana apenas monitor/novas telas quando solicitada, sem repetir PASS anteriores.
F. Autorização futura PROD; não publicar main/V2.9, não enviar WhatsApp, não coletar dados reais.

Próxima ação: receber número/IDs públicos da conta Meta autorizada e parecer escrito da contadora/jurídico; preparar mapeamento/OTP/dispatcher real em nova etapa TEST apenas após requisitos e autorização específicos. Até lá preservar todas as flags OFF. A Central IA continua projeto separado; só contrato técnico inerte, nenhum banco/cliente/segredo compartilhado.
