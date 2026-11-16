# Pagamentos, carteira e conciliação
## Intenção de produto
Pix prioritário; cartão e saldo também; dinheiro físico permanece.
A plataforma intermedeia valores digitais até conclusão. A forma real de retenção, split, onboarding e saque depende do provedor. Não implementar custódia financeira própria presumida.

## Adaptador proposto
PaymentGateway: createPayment, getPayment, verifyWebhook, requestRefund, requestPayout, getPayout.
MockGateway: cenários sucesso, falha, atraso, webhook duplicado e reembolso. Somente ambientes de desenvolvimento.
Produção deve falhar na inicialização se gateway=mock ou parâmetros comerciais não definidos.
Não enviar dados de cartão ao backend da aplicação; usar componente/tokenização do provedor escolhido.

## Ledger
Diário append-only, partidas balanceadas por moeda, centavos inteiros.
Contas lógicas: clearing do provedor, carteira disponível do contratante, reserva por contrato/unidade, saldo liberado do trabalhador, saque em trânsito, receita de comissão, obrigação de multa.
Saldo exibido deriva do ledger (cache reconciliável), nunca de edição manual em users.balance.
Dinheiro devido por multa deve estar separado de valores disponíveis para saque; mostrar dívida e saldo, sem permitir sacar dinheiro inexistente.
Estorno contábil referencia lançamento original; não apagar lançamentos.

### Exemplos conceituais de transferências
Pix confirmado R$120: clearing → reserva da unidade, 12000 centavos.
Liberação sem comissão no exemplo: reserva → disponível do trabalhador, 12000.
Cancelamento integral ainda retido: reserva → carteira do contratante, 12000.
Pedido de saque: disponível → saque em trânsito; sucesso finaliza na conta de saída do provedor; falha devolve disponível uma vez.
Comissão digital divide o valor liberado segundo policy_snapshot; não calcular com configuração alterada depois da contratação.
Espécie R$120: registro externo de 12000, nenhum lançamento fictício no clearing.

## Hora/diária e etapas
Tarifa, unidade, quantidade estimada e limite autorizados ficam no acordo.
Hora: armazenar minutos; valor = arredondamento decimal definido sobre tarifa * minutos/60. PROPOSTA: half-up em centavos ao fechar a unidade.
Diária: inteiro de dias por padrão; frações e mínimo exigem acordo explícito, sem inventar cobrança.
Financiar estimativa inicial; adicional aprovado e pago antes de extensão.
Ex.: 3000 centavos/h × 240min = 12000. 180min aprovados = 9000 liberados e 3000 crédito de carteira.
Horas acima do teto sem aprovação não são cobradas automaticamente; suporte pode resolver.
Por semana, registrar início/fim no fuso local e instantes UTC; convenção semanal configurável.
PROPOSTA: semana de segunda a domingo no fuso do serviço.
Etapa longa não transfere saldo de outra etapa silenciosamente.
Cancelamento de futuras etapas não desfaz trabalho já aceito.

## Proteções e integrações
Assinatura de webhook, unique(provider,event_id), idempotency key, conferência de moeda/valor/beneficiário.
Recebimento de webhook grava evento e outbox atomicamente, processa com retry e fila de falhas.
Conciliar diariamente saldo/provedor/ledger; divergências geram ticket.
Separar payment, refund, release e payout; sucesso em um não implica sucesso nos outros.
Cartão: prever chargeback e valores já sacados como fluxo de disputa financeiro próprio.
Saques: titularidade e validação pelo provedor; duração/taxas/limites ainda pendentes.
Reembolso interno em carteira é uma decisão de UX pendente de compatibilidade com regras e capacidades do provedor. Manter adaptador capaz de devolver à origem quando necessário.
Antes de operação real, resolver fornecedor, comissão, tarifas de processamento, chargebacks, política de devolução, tributos/documentos e responsabilidades contratuais. Isto é uma lista de implementação, não parecer jurídico.
