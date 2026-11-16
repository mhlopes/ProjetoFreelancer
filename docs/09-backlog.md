# Backlog e sequência de implementação
Esta é uma sequência técnica; não retira categorias ou funções aprovadas do escopo total.
Nenhuma funcionalidade implementada no momento de entrega deste pacote.

| ID | Entrega | Dependências | Critério de conclusão |
|---|---|---|---|
| B01 | Fundação local | nenhuma | app inicia; banco e migration; CI básica; mocks explícitos; README de execução |
| B02 | Contas e permissões | B01 | mesma conta com dois modos; autenticação; isolamento por recurso; empresa pendente |
| B03 | Catálogo/perfil/disponibilidade | B02 | tags, raio e agenda; verificação mock controla elegibilidade |
| B04 | Pedido/proposta/chat | B03 | publicar, negociar, renovar; endereço redigido; histórico de versões |
| B05 | Contrato e calendário | B04 | aceite do contratante; múltiplas vagas; lock e conflito de agenda testados |
| B06 | Pix simulado e ledger | B05 | confirmação via webhook fake validado; duplicação testada; reserva de fundos |
| B07 | Execução e conclusão | B06 | início, conclusão, confirmação/24h, contestação impede release |
| B08 | Carteira/cancelamento/saque | B07 | compensação, crédito, dívida separada, saque idempotente e conciliação mock |
| B09 | Avaliações e proteção | B07 | publicação bilateral, denúncia/bloqueio; sem vazamento de nota |
| B10 | Etapas/horas/diárias | B08 | acordo versionado, semana, adicionais e aprovação; teto financiado |
| B11 | Matching e notificações | B05 | grupos, dedupe, push/fallback, agenda e elegibilidade |
| B12 | Painel de suporte | B08,B09 | empresa/credenciais, disputas, multas, auditoria, análise 3 multas |
| B13 | Entregas/transporte/segurança | B10,B12 | campos por categoria; códigos; controles de habilitação |
| B14 | Integrações reais e hardening | B01–B13 | fornecedores, políticas, credenciais, segurança, restauração e homologação |
| B15 | Premium | pós-lançamento | requisitos refinados; nunca necessário ao MVP |

## Primeiro incremento solicitado ao Claude
B01–B04 em escopo reduzido: um contratante fictício publica limpeza urgente, trabalhador elegível faz contraproposta, ambos conversam, contratante vê valor atualizado.
Em seguida B05–B07 para um contrato digital com pagamento simulado e conclusão.
Não chamar o primeiro incremento de produto completo.

## Definition of Done
Regras de domínio e autorização no servidor; migrations reprodutíveis; erros úteis; mobile e teclado; testes de regras alteradas; sem segredos; comando de validação documentado; status atualizado.
Integração mock rotulada na UI/ambiente administrativo; não sugerir operação financeira real.

## Portão de produção
Pendências comerciais e de provedor resolvidas; categoria regulamentada validada localmente; aprovação de políticas; documentos privados; autenticação admin reforçada; testes de concorrência; backups; observabilidade; suporte preparado; plano de rollback.
Infraestrutura de Brasil inteiro não implica oferta real em cada cidade: tratar falta de profissionais explicitamente.
