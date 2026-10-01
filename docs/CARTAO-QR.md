# PepDay — Cartão físico com QR

## Prioridade
O cartão físico vem antes de Instagram/automação e será o primeiro canal comercial presencial para teste de aquisição.

## Formato de impressão
- 9 × 5 cm, frente e verso.
- Sangria: 3 mm.
- Direção visual: dark premium PepDay, azul/ciano.
- QR grande, com área de respiro suficiente para leitura rápida.
- Entrega final prevista: PDF pronto para gráfica + PNG/JPG de conferência.

## Oferta aprovada
- 30 dias de PepDay PRO grátis.
- Sem cartão para ativar.
- Sem cobrança automática.
- O benefício do QR substitui o trial padrão de 7 dias; não acumula os dois períodos.
- Benefício único por conta. Uma conta que já usou os 7 dias padrão pode receber os 30 dias do cartão, desde que não esteja com PRO pago ativo no momento da concessão.
- Depois que o benefício do cartão foi concedido, o trial padrão não pode ser iniciado posteriormente.
- Após os 30 dias, a conta volta ao FREE e o usuário pode contratar PRO mensal/anual normalmente.

## Frente — copy aprovada
PEPDAY

Sua rotina. Seus números. Seu controle.

GANHE 30 DIAS DE PEPDAY PRO GRÁTIS

Escaneie o QR Code, crie sua conta e libere todos os recursos PRO.

Sem cartão • Sem cobrança automática

Aponte a câmera do celular e comece grátis.

## Verso — copy aprovada
O que é o PepDay?

Um aplicativo para calcular, organizar e acompanhar sua rotina em um só lugar.

✓ Calculadora mg, mcg, mL e UI
✓ Seringa visual U-100
✓ Rotinas e lembretes
✓ Controle de frascos e histórico

Escaneie o QR Code, crie sua conta e comece seus 30 dias PRO grátis.

Ferramenta de cálculo e organização. Não recomenda doses, tratamentos ou protocolos.

## QR e rastreamento
- Domínio definitivo escolhido, registrado e pago: `pepday.com.br`.
- O QR final deve apontar para `https://pepday.com.br/cartao/` ou redirect público permanente equivalente.
- Não imprimir QR apontando para ambiente de homologação.
- A origem do QR/cartão é registrada como `card / qr / cartao-v1` e o painel acompanha concessão dos 30 dias, primeiro uso, término e conversão posterior para PRO mensal/anual.
- Backend TEST ativo pela migration `20261001184711_card_qr_30d_benefit.sql`; o QR físico definitivo só entra na arte depois do cutover/validação do domínio de produção.

## Recuperação pós-benefício — padrão aprovado

O objetivo após o fim dos 30 dias do cartão/QR é recuperar usuários sem acostumá-los a esperar novas extensões grátis. O fluxo comercial padrão será:

1. **Dia 27–29:** aviso leve de que os 30 dias PRO estão terminando, com CTA para conhecer/assinar os planos mensal e anual.
2. **Dia 30:** o benefício termina normalmente e a conta volta ao FREE, sem perda de dados.
3. **Dia 32–33:** se ainda não houver assinatura, enviar mensagem de retomada, por exemplo “Quer continuar de onde parou?”, direcionando para PRO.
4. **Dia 35–37:** se ainda não houver conversão, disponibilizar uma oferta de recuperação com desconto real na assinatura, a ser definida antes da implementação (primeira mensalidade e/ou condição especial no anual).
5. **Depois da oferta:** registrar no painel se a pessoa foi recuperada e qual plano contratou (mensal ou anual).

### Separação entre cortesia e desconto
- Os códigos PRO atuais de 30/60/90 dias permanecem reservados para cortesia, parceiro, loja, suporte, influenciador ou ação especial.
- O fluxo de recuperação comercial usará um **novo tipo de cupom/desconto**, separado dos códigos que concedem dias grátis.
- Não conceder automaticamente um novo período de 30 dias como estratégia padrão de recuperação.
- Valor/percentual do desconto será decidido comercialmente antes da implementação e não deve ser inventado no backend.

### Elegibilidade e contato
- Mensagens promocionais de recuperação só devem ser enviadas quando houver consentimento de marketing válido.
- A automação futura deve usar o pipeline do Brevo e respeitar preferências/consentimentos já registrados.
- O painel deve distinguir: **30 dias encerrados → não assinou → elegível para recuperação → oferta enviada → recuperado → mensal/anual**.
- Métricas de recuperação devem permanecer separadas de receita paga e de acessos promocionais gratuitos.
