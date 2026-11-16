# Contrato inicial de operações HTTP
Proposta REST /api/v1; produzir OpenAPI executável durante a primeira fase. Este arquivo é contrato conceitual, não implementação.
Sessão autenticada; cookies seguros e proteção CSRF quando baseada em cookie.
Envelope de erro: {code, message, fieldErrors?, correlationId}.
400 inválido; 401 não autenticado; 403 sem permissão; 404 não visível; 409 conflito; 422 regra de domínio; 429 limite.
Paginação por cursor; limite máximo no servidor.
Idempotency-Key obrigatória em pagamento, aceite, liberação, multa, reembolso e saque. Mesma chave/corpo retorna mesmo resultado; chave com corpo diferente retorna 409.

| Método/rota | Ator e comportamento |
|---|---|
| GET/PATCH /me | dono; perfil e modo |
| POST /me/verification | dono; iniciar validação via adaptador |
| PUT /me/availability | trabalhador; online/agenda/raio |
| POST /organizations | responsável; cria pending_review |
| GET /categories | público; categorias habilitadas |
| POST /requests | contratante; cria rascunho |
| POST /requests/:id/publish | dono; valida e publica |
| POST /requests/:id/renew | dono; novo ciclo sem duplicar contratos |
| GET /requests/:id | ACL e endereço redigido conforme contratação |
| POST /requests/:id/proposals | candidato elegível; preço/escopo/unidade |
| POST /proposals/:id/counteroffers | participante; nova versão |
| POST /proposals/:id/accept | contratante; version esperada, reserva vaga/agenda |
| POST /contracts/:id/payments | contratante; valor derivado do acordo no servidor |
| POST /contracts/:id/departure | trabalhador; evento de deslocamento |
| POST /contracts/:id/start | partes conforme modalidade; código para transporte se habilitado |
| POST /contracts/:id/changes | participante; proposta de alteração |
| POST /changes/:id/approve | contraparte; aceita versão exata |
| POST /units/:id/work-logs | trabalhador; minutos ou diárias, data |
| POST /units/:id/submit | trabalhador; conclusão e deadline |
| POST /units/:id/approve | contratante; liquidação idempotente |
| POST /units/:id/disputes | participante; bloqueio antes de liberação |
| POST /contracts/:id/cancellation-preview | participante; cálculo sem mutação |
| POST /contracts/:id/cancel | participante; confirma preview/policy version |
| POST /contracts/:id/cash-confirmation | participante; confirmação independente |
| GET/POST /conversations/:id/messages | participantes; limites e anexos |
| POST /contracts/:id/reviews | participante; uma avaliação; ocultar contraparte até ambas |
| GET /wallet /wallet/entries | dono; disponível, retido, em saque, dívida |
| POST /wallet/payouts | dono elegível; saldo e destino verificados |
| POST /blocks /reports | autenticado; registra proteção |
| POST /webhooks/payments/:provider | assinatura do provedor, sem sessão de usuário |
| POST /admin/disputes/:id/resolve | suporte autorizado, justificativa e auditoria |
| POST /admin/penalties/:id/void | suporte, anula e recalcula contagem |
| POST /admin/organizations/:id/review | admin, aprova ou rejeita com motivo |

## Exemplos mínimos
Proposta: {"amountCents":12000,"currency":"BRL","billingUnit":"fixed","scope":"Limpeza de cozinha","expectedVersion":1}
Registro: {"date":"2026-11-16","minutes":180,"expectedVersion":1}
Aceite: {"proposalVersionId":"uuid","paymentMode":"pix","expectedRequestVersion":2}
Nunca aceitar total calculado pelo browser como verdade.
Eventos internos: RequestPublished, ProposalAccepted, PaymentConfirmed, UnitSubmitted, DisputeOpened, UnitReleased, PayoutSettled.
Outbox inclui event_id, aggregate_id, version, occurred_at e payload mínimo.
