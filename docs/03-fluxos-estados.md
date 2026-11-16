# Fluxos e estados
As entidades têm máquinas de estado independentes. Nunca usar um único status para pedido, contrato e dinheiro.

## Pedido
draft → open → closed | expired | cancelled.
open aceita propostas; closed impede novas vagas. Renovação de expired cria novo ciclo de divulgação, preserva histórico.
Contagem de vagas: contratos reservados/ativos; usar transação e bloqueio por pedido.

## Proposta
submitted → countered → accepted | rejected | withdrawn | expired.
Aceitar uma versão invalida versões anteriores para contratação. Contraoferta nunca altera contrato já assinado sem change order.
PROPOSTA: reserva de vaga e agenda por 15min durante pagamento; configurável.
Após timeout, liberar reserva. Pagamento tardio vai para conciliação/reembolso, não recupera vaga ocupada.

## Contrato
awaiting_funding → confirmed → en_route → in_progress → completion_requested → completed.
confirmed → in_progress sem deslocamento, quando aplicável.
Qualquer cancelamento permitido → cancelled, com fechamento financeiro separado.
Espécie: confirmed após aceite das condições, sem awaiting_funding digital.
Trabalho longo: estado principal acompanha execução; unidades financeiras têm seus próprios estados.
Disputa é entidade paralela e flag de bloqueio financeiro; não apagar estado anterior.

## Unidade de pagamento
planned → awaiting_funding → funded → in_progress → submitted → approved → released.
submitted → disputed → resolved (release/refund/partial).
Proposta: serviço fechado curto = uma unidade; etapa = uma unidade; semana de hora/diária = uma unidade.
Dinheiro físico usa external_due → external_reported → external_confirmed, sem ledger de pagamento custodiado.

## Conclusão e relógio
Somente trabalhador vinculado solicita conclusão com evidência mínima e resumo do executado.
deadline = submitted_at + 24h, no servidor.
Aprovação explícita e job de expiração usam a mesma função transacional de liquidação.
Disputa recebida até deadline inclusive tem prioridade. Rechecar status sob lock, não confiar no payload do job.
Uma alteração material pendente impede liquidação automática dessa parcela.
PROPOSTA: se notificação falhar persistentemente, sinalizar suporte; política de extensão deve ser definida.
Jobs persistentes recuperam indisponibilidade: worker pode executar depois, sem alterar o prazo original.

## Concorrência obrigatória
- Duas aprovações para última vaga: apenas uma vence, outra recebe 409.
- Dois serviços sobrepostos: apenas um confirma.
- Webhook repetido: um lançamento.
- Job e confirmação manual simultâneos: uma liberação.
- Contestação e liberação simultâneas: reavaliar deadline e estado dentro da transação.
- Saques simultâneos: saldo disponível nunca negativo; dívida de multa é conta separada.
- Cancelamento de etapa concluída: não reverter automaticamente dinheiro já liberado.

## Fluxo principal
Publicar → distribuir → negociar → aprovar profissional → financiar/confirmar espécie → executar → registrar conclusão → aprovar ou contestar → liberar/reconciliar → avaliar.
