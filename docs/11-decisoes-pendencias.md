# Registro de decisões e pendências
## Aprovado pelo fundador
D01 Brasil inteiro; pessoas e empresas freelance.
D02 Site mobile-first; nome/visual abertos.
D03 Duas áreas na conta; online só trabalhador.
D04 Matching em grupos; contratante aprova, chat e contrapropostas.
D05 Urgentes/agendados; pedido 3h renovável; agenda sem sobreposição e sem buffer de deslocamento.
D06 Múltiplos profissionais, contratos individuais, pode fechar com menos.
D07 Identidade/telefone; empresa aprovada; qualificação por categoria; maiores de 18.
D08 Pix, cartão, espécie; carteira para reembolsos/ganhos; saque solicitado.
D09 Liberação após confirmação ou 24h sem contestação.
D10 Longos por etapas e fechamento semanal de hora/diária; trabalhador registra, contratante aprova.
D11 Multa percentual; três válidas em 12 meses → análise; sem suspensão automática.
D12 Avaliações somente após ambos; sem prazo alternativo.
D13 Premium depois; suporte pelos fundadores.
D14 Categorias gerais, entregas, segurança e transporte particular/personalizado.

## Propostas deste pacote (reversíveis)
P01 Stack TypeScript/Next/PostgreSQL e worker; sem versões fixadas.
P02 Pagamento após seleção/negociação e antes de iniciar, em vez de ao publicar pedido.
P03 Reserva de vaga por 15min durante pagamento.
P04 Grupos de 10/60s/5km como parâmetros de demonstração.
P05 Reputação por papel; semana segunda–domingo; arredondamento half-up.
P06 Flags operacionais por categoria; transporte detalhado com veículos, códigos e paradas.
P07 Tolerância de notificação e heartbeat de online a implementar com configuração.
Não apresentar P como exigência histórica do fundador.

## Propostas técnicas adotadas na implementação (2026-11-15, reversíveis)
Registradas pelo Claude ao construir o protótipo. Nenhuma é decisão do fundador; todas podem ser revistas.

| ID | Escolha | Motivo e impacto de reverter |
|---|---|---|
| T01 | PostgreSQL **embarcado (PGlite)** em vez de servidor PostgreSQL | A máquina não tinha Postgres nem Docker. O SQL e as migrations são PostgreSQL padrão (constraint de exclusão, triggers, FOR UPDATE). Trocar por servidor real = novo driver em `src/lib/db.ts` com a mesma interface `q/tx`. Limite: PGlite tem conexão única e serializa transações; os testes de concorrência provam a lógica, mas ainda não exercitam locks reais entre conexões. |
| T02 | Jobs em processo (varreduras idempotentes a cada 15s) em vez de worker separado | Consequência de T01 (um processo por banco embarcado). As varreduras derivam do estado no banco e revalidam tudo sob trava; mover para worker separado não muda a lógica. |
| T03 | Autenticação própria mínima: e-mail + senha (scrypt), sessão por cookie httpOnly com token aleatório guardado em hash | Evita acoplar a um fornecedor antes da decisão de KYC/OTP. Substituível por biblioteca/fornecedor mantido antes de produção. O e-mail foi acrescentado ao cadastro como identificador de login. |
| T04 | Formulários por Server Actions + API REST `/api/v1` (subconjunto de docs/07-api.md) chamando os mesmos serviços | Uma única implementação das regras. A API tem envelope de erro, Idempotency-Key e checagem de origem. Sem OpenAPI ainda. |
| T05 | Ledger com lançamentos **assinados** (+crédito/−débito) somando zero por transação | Equivale a débito = crédito. Imutabilidade e balanceamento garantidos por triggers; saldo em cache com CHECK de não-negativo. |
| T06 | Duas contas por usuário: **ganhos** (sacável) e **crédito** (reembolsos, usável para contratar) | Mantém a pendência O03 isolada: o crédito de reembolso não vira saque sem decisão. Não é possível hoje pagar serviço com ganhos nem sacar crédito. |
| T07 | Forma de pagamento (digital ou dinheiro) definida **no pedido**; o método digital (Pix/cartão/carteira) é escolhido na aprovação | O trabalhador sabe antes de propor se receberá em espécie. |
| T08 | Proposta: concordância do trabalhador com contraproposta do contratante é um passo explícito que **não contrata**; só versão escrita ou aceita pelo trabalhador pode ser aprovada | Implementa o invariante “contratante aprova” nos dois sentidos da negociação. |
| T09 | Cancelamento pelo **trabalhador** segue os mesmos marcos do contratante (urgente: grátis antes do deslocamento; agendado: >24h ou 30min de tolerância) e a multa dele vira **débito separado** | R24/R25 só descrevem o contratante; R30 está pendente. Precisa de ratificação (ver O05/O13). |
| T10 | Multa do contratante com valor retido: paga ao profissional como compensação direto da reserva, **sem comissão** | Segue a PROPOSTA R30. Destino final das multas continua pendente (O05). |
| T11 | Ausência (R26): exige mensagem de quem reclama no chat (para agendados, a partir do horário marcado) e 15 min de espera contados dessa mensagem | Para **urgentes** não existe horário combinado de chegada; a regra atual permite registrar ausência 15 min após o contato, o que pode ser cedo demais. Precisa de definição (O14). A multa é sempre anulável pelo suporte. |
| T12 | Dívida de multa não é cobrada nem abatida automaticamente e não bloqueia saque | Aplicação literal de O05 (“não bloquear por suposição”). |
| T13 | Anular multa já paga com valor retido **não** reverte o dinheiro automaticamente; fica anotado na auditoria para decisão financeira própria | Evita saldo negativo de quem já sacou. |
| T14 | Contestação aceita até o prazo de 24h **inclusive**; o job só libera depois de 24h completas | Dá prioridade à contestação no empate, como pede docs/03. |
| T15 | Registrar a conclusão libera a agenda do trabalhador (a reserva deixa de bloquear o horário restante) | Sem isso, quem termina cedo ficaria impedido de aceitar outro chamado. |
| T16 | Matching: sem coordenadas de um dos lados, usa mesma cidade/UF; raio do grupo n = 5 km × n, limitado ao raio do trabalhador e ao máximo da categoria; quem recebeu o chamado vê o pedido | Localização é opcional (consentimento). Cálculo de distância feito na aplicação; trocar por PostGIS quando houver volume. |
| T17 | Fuso por UF (o da capital); horários informados no fuso do local do serviço | Estados com mais de um fuso ficam aproximados até haver geocodificação (O08). |
| T18 | Categorias entregas, segurança e transporte ficam **desligadas por flag**; a API recusa mesmo com a interface contornada | Entregas dependem de código de confirmação (B13), ainda não implementado. |
| T19 | Agenda do trabalhador livre por padrão, com “períodos indisponíveis” informados por ele | Mais simples que grade semanal; contratos confirmados bloqueiam automaticamente. |
| T20 | Reembolsos (cancelamento, sobra de horas, pagamento tardio) vão para o crédito da carteira | É a intenção de produto atual (R21); o registro `refunds.destination` já prevê devolução à origem. |

Novas pendências surgidas na implementação: O13 — critério de multa e cobrança quando o trabalhador cancela (hoje T09). O14 — quando configura ausência em chamado urgente (hoje T11). O15 — se ganhos podem pagar serviços e se crédito de reembolso pode ser sacado (hoje T06: não).

## Pendências para lançamento
| ID | Ponto | Desenvolvimento pode seguir com |
|---|---|---|
| O01 | Comissão e quem absorve taxa do provedor | zero sintético; exigir valor em produção |
| O02 | Provedor Pix/cartão/marketplace/KYC/saque | adaptador mock |
| O03 | Retenção, carteira e devolução apenas em saldo | abstração com possibilidade de refund à origem |
| O04 | Percentuais/tetos exatos: sugestão 10%/R$100 e 20%/R$200 | política draft; não ativar em produção |
| O05 | Destino da multa, cobrança de dívida e restrições por inadimplência | débito separado; não bloquear por suposição |
| O06 | Requisitos locais de transporte/segurança, documentação | módulos simulados e flags off |
| O07 | Períodos de retenção, termos e tratamento de documentos | mínimos dados fictícios |
| O08 | Fornecedor de mapas, OTP, push e hospedagem | interfaces e mocks |
| O09 | Como calcular preço sugerido por categoria/região | tabela admin demonstrativa, sem alegar preço de mercado |
| O10 | Critérios de mínimo/fração de diária | acordo explícito; não arredondar arbitrariamente |
| O11 | Políticas após falha de notificação, incidentes ou chargeback | fila de suporte e bloqueio da parcela envolvida |
| O12 | Ratificar sequência de pagamento e detalhes de transporte | fluxo recomendado marcado na UI de demonstração |

## Contradições resolvidas
“Três suspensões” foi substituído por “três multas em 12 meses”.
Liberação em 1h foi substituída por 24h.
Avaliação após 7 dias NÃO foi aprovada; só bilateral.
Intervalo de deslocamento foi rejeitado.
Premium inicial foi adiado.
Ausência de aprovação manual geral do trabalhador não elimina validação de identidade e credenciais.
Nome comercial não foi definido. Não usar nome de outro projeto do usuário.
