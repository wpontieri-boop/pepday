# PepDay — Procedimento de Resposta a Incidentes LGPD

Versão interna: 30/09/2026.

## Objetivo

Este procedimento orienta a resposta a incidentes que envolvam dados pessoais tratados pelo PepDay, especialmente dados que possam revelar informações de saúde.

Aplica-se ao ambiente de produção e deve ser usado como referência também em homologação. Ele não substitui assessoria jurídica especializada em incidentes concretos.

## Gatilhos

Tratar como incidente potencial qualquer suspeita de:
- acesso não autorizado a conta ou banco;
- vazamento, perda, alteração ou destruição indevida de dados;
- exposição de credenciais, tokens ou segredos;
- envio de notificação ou e-mail com conteúdo sensível ao destinatário errado;
- falha de autorização que permita acesso entre contas;
- indisponibilidade ou corrupção que comprometa integridade/confidencialidade de dados.

## Resposta imediata

1. Registrar data e hora em que o PepDay tomou conhecimento.
2. Conter o incidente sem destruir evidências: revogar credenciais, bloquear rota, desativar função ou isolar componente quando necessário.
3. Preservar logs técnicos mínimos e evidências, evitando copiar dados sensíveis além do necessário.
4. Identificar sistemas, categorias de dados e titulares potencialmente afetados.
5. Corrigir a causa técnica e validar que a contenção foi efetiva.
6. Avaliar risco ou dano relevante aos titulares, considerando especialmente dados sensíveis, autenticação, dados financeiros, escala e possibilidade de uso indevido.

## Comunicação

Quando o incidente puder acarretar risco ou dano relevante, o controlador deve avaliar a comunicação à ANPD e aos titulares conforme a Resolução CD/ANPD nº 15/2024.

Como regra operacional, considerar o prazo de **3 dias úteis** contado do conhecimento de que o incidente afetou dados pessoais, ressalvada legislação específica e eventual regra diferenciada aplicável ao agente de tratamento.

Se as informações ainda estiverem incompletas, registrar o que falta e avaliar comunicação preliminar seguida de complementação.

## Conteúdo mínimo do registro

Manter registro inclusive de incidentes que não forem comunicados, contendo ao menos:
- data do conhecimento;
- descrição geral das circunstâncias;
- natureza e categorias de dados afetados;
- número estimado de titulares afetados;
- avaliação de risco e possíveis danos;
- medidas de correção e mitigação;
- forma e conteúdo das comunicações realizadas;
- motivo da ausência de comunicação, quando for o caso.

O registro deve ser mantido por **no mínimo 5 anos** a partir da data do registro, salvo obrigação adicional que exija prazo maior.

## Comunicação ao titular

Quando exigida, usar linguagem simples e direta. Informar:
- natureza e categorias de dados afetados;
- medidas de segurança relevantes, sem expor segredos de segurança;
- riscos e possíveis impactos;
- medidas adotadas ou planejadas para mitigar efeitos;
- data de conhecimento do incidente;
- canal para informações adicionais.

Dar preferência a comunicação direta e individualizada quando os titulares puderem ser identificados.

## Responsáveis e checklist de fechamento

Antes de produção, preencher o responsável jurídico/controlador e o contato operacional de segurança.

Um incidente só pode ser considerado encerrado após:
- causa raiz identificada ou risco residual documentado;
- correção implantada e testada;
- credenciais potencialmente expostas rotacionadas;
- impacto aos titulares avaliado;
- decisão de comunicar ou não comunicar documentada;
- comunicações obrigatórias realizadas;
- ações preventivas registradas;
- evidências e registro do incidente preservados conforme o prazo aplicável.

Referências normativas principais: LGPD (Lei nº 13.709/2018) e Resolução CD/ANPD nº 15/2024.
