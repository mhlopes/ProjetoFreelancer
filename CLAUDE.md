# Instruções do projeto
## Missão
Construir marketplace brasileiro de serviços presenciais: pessoas e empresas contratam trabalhadores independentes por chamados, propostas e aprovação. Site mobile-first; nome provisório “Plataforma de Serviços”.

## Antes de desenvolver
Leia README.md, docs/01-produto.md, docs/02-regras.md, docs/04-pagamentos.md, docs/11-decisoes-pendencias.md e docs/12-status.md. Consulte os demais documentos conforme a tarefa.
Decisões explícitas do usuário prevalecem. Não transforme sugestões anteriores em decisões aprovadas.
Proponha escolhas técnicas reversíveis e registre em decisões; não pare por nome, cor, comissão ou fornecedor ausente: use configuração e adaptadores simulados.
Não escolha fornecedores nem ative operações reais sem configuração e validação apropriadas.

## Invariantes
- Aceitar uma proposta de trabalhador NÃO contrata automaticamente: contratante aprova.
- Uma conta pode contratar e trabalhar; permissões são verificadas no servidor.
- Pedido com N vagas gera contratos independentes, no máximo N ativos.
- Dinheiro: BRL em centavos inteiros; horas/minutos sem ponto flutuante financeiro.
- Pagamento confirmado apenas por evento validado do provedor; redirecionamento do navegador não prova pagamento.
- Ledger imutável e balanceado; webhooks, saques e liberações idempotentes.
- Não liberar valores contestados, não pagos ou não aprovados.
- 24h contam da solicitação válida de conclusão da unidade de pagamento. Contratante pode confirmar antes.
- Dinheiro físico não gera pagamento digital fictício nem comissão de serviço.
- Reembolso em carteira é intenção de produto; registrar pendência de viabilidade antes de produção.
- Endereço exato e documentos privados não aparecem na listagem pública.
- Avaliações só se tornam públicas quando ambos avaliam, sem publicação unilateral por prazo.
- Premium fora da primeira versão.
- Transporte e segurança constam do escopo, com liberação operacional condicionada a requisitos próprios.
- Não alegar que protótipo ou mock está pronto para movimentar dinheiro real.

## Método
Implemente uma fatia por vez com domínio, persistência, autorização, interface e testes pertinentes.
Faça migrations versionadas e dados fictícios reproduzíveis. Nunca use CPF/documentos reais em fixtures.
Não invente resultados de testes. Registre comandos executados, resultados, limitações e próximos passos.
Ao finalizar uma sessão, atualize docs/12-status.md. Não sobrescreva alterações do usuário.
Não troque stack silenciosamente; documente motivo e impacto.
Não use permissões administrativas para contornar regras do domínio. Ações de suporte devem ser auditadas.
Não exponha segredos em commits, logs ou interfaces.
