# Segurança interna PepDay TEST em 12/10/2026

## Escopo e evidência
Recuperação do checkpoint ba3fbcd, branch v3.0-bloco-b. Sem PROD/main/V2.9 e sem alteração de autenticação Admin/P1/P2/P3. Aprovação comercial interna não substitui requisitos efetivos de segurança da LGPD art.46.

Migration aplicada uma vez: 20261012174732_partner_internal_security_test. Arquivo e história MD5 f544224c08d92ec73c6d3517843345a9 idênticos; não reaplicar. Pré-instalação criação+assertions em transação rollback PASS; pós-instalação assertions internas e portal rollback PASS. 17 usuários/2 parceiros/0 convites permanentes após testes. Flags disabled/real_send=false/real_collection=false/central_enabled=false.

## Correções comprovadas
- Tentativas de challenge: quota derivada no banco do próprio convite e teto compartilhado 200/hora; convite 20/hora. Hash enviado pelo cliente e X-Forwarded-For falsificado não criam orçamento novo. Helpers privados e sem grants. O teto global pode negar serviço sob abuso; nesta fase é contenção TEST, não promessa de disponibilidade/limite distribuído em produção.
- Opt-out agora cancela o canal, filas e lembretes sem revogar acesso ao próprio portal. Mensagens permanecem negadas por opt_in=false. Revogação explícita, expiração e reemissão continuam negando sessões.
- Upload Edge revalida os bytes do único PNG sintético conhecido por SHA256 antes de qualquer escrita. Byte alterado, arquivo arbitrário ou resultado indisponível é negado. Não foi habilitado recebimento real.
- Política SyntheticQuarantine OFFLINE: acesso por dono QA, cópia imutável, expiração 120s, decisão de scanner/versionamento/hash, descarte por falha; não é serviço de antivírus genérico. O scanner é allowlist SHA256 de amostra conhecida, não ClamAV. Arquivos reais permanecem proibidos.
- Recuperação OFFLINE: snapshot exclusivamente QA cifrado AES-256-GCM, chave efêmera não exportável, AAD, integridade, destino test-isolated-restore. Corrupção, chave errada, dados não QA e destino PROD negados. Não é backup operacional nem restauração de PostgreSQL/Storage reais.
- Nove textos legais versionados/hash, visualização somente homologação, textContent, sem armazenamento de sessão/PII e sem aceite.

## Resultados reais
- Regressão serial 593/593 PASS, zero falhas/skip, build TEST e git diff-check PASS.
- Chromium 390x844 e 1280x900: portal/revisão/CSV/monitor OWNER e ADMIN/VIEWER negados; backend interceptado, sem escrita real. Novos nove instrumentos/hash/aceite negado/sem overflow/sem erros PASS. Não é PASS HUMANO nem validação de identidade civil.
- Edge partner-portal v3 ACTIVE TEST. Manual Word v1.5 sincronizado no mesmo Drive ID 1PYLoYSgRIs-b19i0Bz4HSPIqtnNK-wYm, 45.728 bytes, seis páginas renderizadas e visualmente inspecionadas. meta-whatsapp-gateway v1 permanece default disabled e sem número real.
- Advisors TEST: 0 ERROR; INFO RLS sem políticas 54 (schemas privados deliberadamente sem acesso direto); WARN uma função anon SECURITY DEFINER legada record_pwa_install_event, 60 funções authenticated SECURITY DEFINER e proteção de senha vazada desabilitada. Não declarar todos WARN como vulnerabilidades ou resolver mudando autenticação já aprovada. Guards de OWNER/AAL2/identidade seguem testes específicos. Remediação oficial: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable e https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
- Secret scanning GitHub: 3 alertas google_api_key resolved/wont_fix, 0 abertos, sem imprimir valores. Encerramento não prova revogação/restrição; dependências de produção não alteradas.

## Requisitos concretos antes de dados reais
Estes são controles de ativação, não contratação obrigatória de advogado/pentest externo.
1. Scanner operacional para arquivos arbitrários: private staging sem acesso por URLs, worker confiável com definições/timeout, decisão vinculada ao hash, promoção clean atômica e bloqueio se indisponível. Realizar ensaio de arquivo de teste antimalware e falhas com dados sintéticos antes de abrir upload. A allowlist atual cumpre a proibição de receber arquivos reais; não cumpre sozinha esse futuro requisito.
2. Backup/recuperação operacional: confirmar plano/recursos sem compra; dump autorizado TEST cifrado fora do Git, Storage separado, chave em controle aprovado, restaurar em instância isolada já autorizada e comparar contagens/hashes/grants. Backups DB do Supabase não incluem objetos Storage: https://supabase.com/docs/guides/platform/backups. Sem alvo isolado/armazenamento seguro demonstrados, não presumir recuperação real nem copiar dados pessoais para scratch. Ensaio QA criptográfico já passou.
3. Chaves Google: proprietário da conta precisa permitir inspeção de restrições API/referrer/IP, uso e dependências. Ferramentas atuais não comprovam configuração no Google Cloud. Registrar evidência sem valores, restringir chave exclusiva TEST se necessário, não revogar PROD às cegas.
4. Identidade/representação/canal: Meta e número verificados permitirão OTP entregue, não código QA fornecido pelo OWNER; verificar poderes com documento mínimo pertinente. Mapeamento de contatos reais, evidência de consentimento e contratos preenchidos só após as condições.
5. Confirmar fornecedores/fluxos LGPD, canal alternativo de direitos e matriz de retenção com contadora. Em TEST não há novo fluxo internacional de documentos reais.

## Próxima ação
Receber definições fiscais e configurar o número único/conta/templates Meta. Antes de permitir dados reais, executar os controles 1–5 em TEST com evidências. Não remover bloqueios por pressão de “somente duas dependências”, não inventar conformidade absoluta. As duas dependências externas previstas são contadora e Meta; os controles internos de ativação não estão falsamente marcados PASS.
