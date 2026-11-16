# Regras de negócio
## Identidade e acesso
R01 Uma conta possui modos contratante e trabalhador. Só trabalhador tem disponibilidade online.
R02 Cadastro básico não equivale a identidade validada. Receber/aceitar chamados depende de telefone e identidade validados.
R03 Empresa depende de aprovação; categorias com qualificação dependem de credencial válida. Bloqueios por segurança/fraude são distintos das suspensões por multa, descartadas na entrevista.
R04 Região é Brasil. Coordenadas são obtidas com consentimento ou endereço informado. Posição pública aproximada.

## Pedidos e matching
R05 Campos: descrição, categoria/tags, local, data/hora, duração estimada, vagas, valor por profissional, modalidade de cobrança; fotos opcionais; materiais/ferramentas e despesas acordados.
R06 Urgente expira em 3h por padrão; renovar, ajustar preço ou cancelar. Expiração encerra novas propostas, nunca cancela contratos já confirmados.
R07 Distribuição em grupos progressivos por disponibilidade, categoria, raio e agenda. Parâmetros exatos são PROPOSTA configurável. Deduplicar alertas.
R08 Trabalhador define serviços e raio. Em agendados, não exigir status online.
R09 Propostas simultâneas e contrapropostas permitidas. Cada versão aceita referencia preço e escopo exatos.
R10 Contratante aprova cada profissional. Impedir autocontratação e ocupação acima do número de vagas.
R11 Agenda bloqueia contratos confirmados sobrepostos; sem buffer de viagem. Antes da confirmação financeira, usar reserva temporária proposta, sem bloquear indefinidamente.
R12 Exibir endereço completo somente às partes do contrato confirmado. Chat de negociação pode preceder contratação; não enviar endereço exato automaticamente nessa fase.
R13 Pedido pode encerrar com menos vagas. Cancelamento individual não afeta os outros contratos automaticamente.

## Execução e finanças
R14 Pequenos serviços: pré-pagamento digital depois do acordo e antes de iniciar. Esta sequência resolve a ambiguidade sobre pagar ao publicar; é PROPOSTA operacional, registrada como tal.
R15 Longos preço fixo: etapas com preço, escopo e prazo; cada etapa financiada antes de iniciar.
R16 Hora/diária: tarifa e estimativa aprovadas; trabalhador registra quantidade; contratante aprova/corrige. Fechamento semanal para longos. Diária registra duração contratual.
R17 Alterações de preço, horas, despesas ou escopo exigem acordo versionado; somente valor já financiado pode ser liberado.
R18 Confirmação mútua libera digital; silêncio por 24h após conclusão válida pode liberar, salvo contestação. Avisar no início e antes do prazo. Não se aplica a valores extras não aprovados.
R19 Saque é solicitado pelo trabalhador. Estados pendente, processando, pago, falhou; sem duplicar débito.
R20 Espécie é pagamento externo confirmado pelas partes, sem comissão de serviço. Multas são obrigação separada; não fabricar crédito na carteira por pagamento externo.
R21 Reembolso em carteira, por decisão atual. Implementar como política configurável e não como pressuposto legal/técnico irrevogável.
R22 Comissão digital não definida. Testes podem usar zero ou taxa sintética claramente marcada; produção exige configuração explícita.

## Cancelamentos
R23 Sem profissional contratado: gratuito.
R24 Urgente: contratante cancela gratuitamente antes do deslocamento; após, compensação limitada.
R25 Agendado: mais de 24h antes, gratuito. Com 24h ou menos, tolerância de 30min após contratação se deslocamento/trabalho não começou; depois multa.
R26 Ausência: contato no chat e espera registrada de 15min. Atraso/risco/justificativa podem ser analisados.
R27 Trabalho já iniciado: acerto do executado e suporte em divergência; não tratar como cancelamento simples integral.
R28 Sem suspensão automática por multas. Três multas válidas nos últimos 12 meses encaminham para análise, sem banimento automático.
R29 PROPOSTA anterior não confirmada numericamente: cancelamento 10% teto R$100; ausência 20% teto R$200; sobre unidade afetada, sem duplicação. Percentual foi aprovado, valores/tetos precisam de ratificação antes de produção.
R30 PROPOSTA: compensação à parte prejudicada e saldo devedor separado quando faltar saldo. Critério de cobrança do trabalhador e destino das multas precisam de ratificação.
R31 Multa anulada não conta. Auditar motivo, regra vigente, base de cálculo e decisão do suporte.

## Avaliações e proteção
R32 Cada parte envia uma avaliação por contrato concluído, nota 1–5 e comentário opcional; critérios opcionais pontualidade, qualidade e comunicação.
R33 Publicação atômica apenas após ambas enviarem. Não revelar nota oculta por API, contagem ou média. Sem prazo de publicação unilateral.
R34 Denúncia e bloqueio impedem futuros encontros/contratações, preservando execução, atendimento e evidências de contratos existentes.
R35 Histórico de reputação por papel é PROPOSTA para não misturar avaliação de contratante e trabalhador.
