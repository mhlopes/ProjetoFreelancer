type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
type L = Record<string, [string, Tone]>;

export const REQUEST_STATUS: L = {
  draft: ['Rascunho', 'neutral'], open: ['Aberto', 'ok'], closed: ['Vagas encerradas', 'neutral'],
  expired: ['Expirado', 'warn'], cancelled: ['Cancelado', 'bad'],
};
export const PROPOSAL_STATUS: L = {
  submitted: ['Aguardando o contratante', 'info'], countered: ['Aguardando o profissional', 'warn'], accepted: ['Aprovada', 'ok'],
  rejected: ['Recusada', 'bad'], withdrawn: ['Retirada', 'neutral'], expired: ['Encerrada', 'neutral'],
};
export const CONTRACT_STATUS: L = {
  awaiting_funding: ['Aguardando pagamento', 'warn'], confirmed: ['Contratado', 'ok'], en_route: ['A caminho', 'info'],
  in_progress: ['Em andamento', 'info'], completion_requested: ['Conclusão registrada', 'warn'], completed: ['Concluído', 'ok'],
  cancelled: ['Cancelado', 'bad'],
};
export const UNIT_STATUS: L = {
  planned: ['Planejado', 'neutral'], awaiting_funding: ['Pagamento pendente', 'warn'], funded: ['Valor retido', 'ok'],
  in_progress: ['Valor retido', 'ok'], submitted: ['Aguardando confirmação', 'warn'], approved: ['Aprovado', 'ok'],
  released: ['Pagamento liberado', 'ok'], disputed: ['Contestado — bloqueado', 'bad'], resolved: ['Resolvido pelo suporte', 'neutral'],
  cancelled: ['Cancelado', 'neutral'], external_due: ['Dinheiro: a pagar no local', 'info'],
  external_reported: ['Dinheiro: profissional confirmou', 'warn'], external_confirmed: ['Dinheiro: confirmado por ambos', 'ok'],
};
export const PAYOUT_STATUS: L = {
  pending: ['Pendente', 'warn'], processing: ['Processando', 'info'], paid: ['Pago', 'ok'], failed: ['Falhou — valor devolvido', 'bad'],
};
export const PAYMENT_MODE: Record<string, string> = { pix: 'Pix', card: 'Cartão', wallet: 'Crédito da carteira', cash: 'Dinheiro físico' };
export const ACCOUNT_KIND: Record<string, string> = {
  client_wallet: 'Crédito da carteira', worker_earnings: 'Ganhos disponíveis', payout_transit: 'Saque em trânsito', penalty_debt: 'Dívida de multa',
};
export const TX_KIND: Record<string, string> = {
  payment: 'Pagamento confirmado', funding_wallet: 'Pagamento com crédito', release: 'Liberação do serviço', dispute_resolution: 'Resolução de disputa',
  cancellation: 'Cancelamento', payout_hold: 'Saque solicitado', payout_paid: 'Saque pago', payout_failed: 'Saque devolvido',
  penalty_debt: 'Multa', penalty_void: 'Multa anulada', refund_wallet: 'Devolução em crédito', payment_late: 'Pagamento fora do prazo',
};
export const KIND: Record<string, string> = { urgent: 'Urgente', scheduled: 'Agendado' };
export const UNIT: Record<string, string> = { fixed: 'preço fechado', hour: 'por hora' };
