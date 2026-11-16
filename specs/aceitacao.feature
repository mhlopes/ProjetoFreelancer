# language: pt
Funcionalidade: Contratação segura e pagamentos consistentes

  Cenário: Aprovação obrigatória do contratante
    Dado um pedido aberto e um profissional elegível
    Quando o profissional aceita o preço anunciado
    Então uma proposta deve ser registrada
    E nenhum contrato deve ser confirmado sem aprovação do contratante

  Cenário: Última vaga concorrente
    Dado um pedido com apenas uma vaga restante
    Quando duas propostas são aprovadas simultaneamente
    Então apenas uma deve reservar a vaga
    E a outra deve receber conflito sem cobrança

  Cenário: Negociação preserva versões
    Dado uma proposta de 10000 centavos e uma contraproposta de 12000 centavos
    Quando o contratante aprova a contraproposta
    Então o contrato deve referenciar a versão de 12000 centavos
    E a versão anterior deve continuar no histórico

  Cenário: Agenda impede sobreposição
    Dado um contrato confirmado para o trabalhador das 10h às 12h
    Quando outra contratação tenta reservar das 11h às 13h
    Então a confirmação deve ser recusada
    Mas um serviço começando às 12h pode ser confirmado

  Cenário: Privacidade antes da contratação
    Dado um candidato sem contrato confirmado
    Quando consulta o pedido e sua API
    Então recebe apenas localização aproximada
    E não recebe documentos nem endereço exato

  Cenário: Pagamento duplicado
    Dado um pagamento confirmado de 12000 centavos
    Quando o mesmo evento assinado é recebido duas vezes
    Então apenas 12000 centavos devem ser registrados como fundos recebidos

  Cenário: Conclusão automática
    Dado uma unidade financiada e conclusão válida solicitada há 24 horas
    E nenhuma contestação ou alteração não aprovada
    Quando o worker processa o prazo
    Então libera apenas o valor autorizado uma vez

  Cenário: Contestação dentro do prazo
    Dado uma conclusão solicitada há 23 horas
    Quando o contratante contesta
    Então a parcela deve ficar bloqueada
    E o job das 24 horas não deve liberá-la

  Cenário: Confirmação manual e job simultâneos
    Dado uma unidade pronta para liberação
    Quando a aprovação manual e o job executam simultaneamente
    Então existe apenas uma transação de liberação

  Cenário: Horas menores que estimativa
    Dado tarifa de 3000 centavos por hora e reserva de 12000 centavos
    Quando ambos aprovam 180 minutos realizados
    Então 9000 centavos são elegíveis para liquidação antes de comissão configurada
    E 3000 centavos retornam à carteira do contratante

  Cenário: Adicional sem autorização
    Dado limite aprovado de 12000 centavos
    Quando o profissional informa quantidade equivalente a 18000 centavos
    Então não deve haver débito automático adicional
    E a diferença deve exigir acordo e financiamento ou análise do suporte

  Cenário: Pagamento em espécie
    Dado um contrato pago diretamente em dinheiro físico
    Quando ambos confirmam a conclusão e o pagamento
    Então o contrato pode ser concluído e avaliado
    E não há crédito digital fictício nem comissão de serviço

  Cenário: Avaliação unilateral oculta
    Dado um contrato concluído
    Quando apenas uma parte avalia
    Então a nota e o comentário ficam ocultos da contraparte e do público
    E não alteram a média pública mesmo após sete dias

  Cenário: Avaliações bilaterais
    Dado uma avaliação oculta
    Quando a outra parte também avalia
    Então ambas são publicadas atomicamente

  Cenário: Cancelamento urgente gratuito
    Dado um contrato urgente sem deslocamento iniciado
    Quando o contratante cancela
    Então não recebe multa
    E os fundos ainda retidos retornam à carteira

  Cenário: Multa demonstrativa com teto
    Dado política de teste de 10 por cento e teto de 10000 centavos
    E base afetada de 200000 centavos
    Quando um cancelamento sujeito a multa é calculado
    Então a multa é 10000 centavos
    E não deve ser aplicada outra multa pelo mesmo fato

  Cenário: Contagem móvel de multas
    Dado duas multas válidas nos últimos 12 meses e uma multa anulada
    Quando uma terceira multa válida é aplicada
    Então uma análise de banimento é encaminhada ao suporte
    E não há suspensão ou banimento automático

  Cenário: Cancelamento de uma vaga
    Dado três contratos independentes em um pedido
    Quando um contrato é cancelado
    Então os outros dois permanecem inalterados

  Cenário: Saques concorrentes
    Dado saldo disponível de 10000 centavos
    Quando dois saques de 8000 centavos são solicitados simultaneamente
    Então no máximo um é reservado
    E o saldo disponível não fica negativo

  Cenário: Pagamento após expiração da reserva
    Dado uma reserva temporária expirada e vaga ocupada por outra pessoa
    Quando o pagamento atrasado da reserva anterior é confirmado
    Então não deve ser criado contrato excedente
    E o valor deve seguir para conciliação e devolução conforme política

  Cenário: Etapa contestada não contamina outras
    Dado duas etapas com valores separados e uma já concluída
    Quando a segunda etapa é contestada
    Então apenas os valores envolvidos na contestação ficam bloqueados
    E a primeira etapa não é estornada automaticamente

  Cenário: Transporte não habilitado
    Dado a categoria transporte desabilitada operacionalmente
    Quando um usuário tenta contratar transporte por API
    Então a operação deve ser recusada mesmo que o frontend seja contornado

  Cenário: Bloqueio preserva histórico
    Dado um contrato existente entre duas pessoas
    Quando uma bloqueia a outra
    Então não devem ser pareadas para novos pedidos
    E o suporte mantém acesso autorizado aos registros do contrato existente
