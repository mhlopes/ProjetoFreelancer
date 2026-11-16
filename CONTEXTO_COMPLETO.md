# CONTEXTO COMPLETO — PLATAFORMA DE SERVIÇOS

Compilação para leitura por um modelo. Os arquivos separados são a fonte editável.



---

# Arquivo: README.md

# Plataforma de serviços presenciais — pacote de contexto
Versão 1.0 • 15/11/2026 • Português do Brasil • Nome comercial não definido.

Este pacote é uma especificação para iniciar o desenvolvimento, não uma aplicação pronta. Foi consolidado da entrevista com o fundador. Não contém credenciais, integrações contratadas ou alegação de conformidade jurídica.

## Como começar
1. Extraia esta pasta na raiz de um novo repositório.
2. Abra o repositório no Claude Code. Leia CLAUDE.md e docs/01-produto.md.
3. Cole prompts/01-iniciar.md. Implemente primeiro a fatia vertical definida no backlog.
4. Antes de alterar dinheiro, concorrência ou permissões, consulte as regras, os estados e os cenários de aceitação.
5. Ao trocar de modelo, use prompts/03-handoff.md e atualize docs/12-status.md.
6. No Claude por navegador, anexe CONTEXTO_COMPLETO.md e o prompt da tarefa. A capacidade de executar código dependerá do ambiente disponível.

Os nomes “Fable 5.2” e “Opus 5.5” são os nomes informados pelo usuário. Este pacote não verifica sua disponibilidade, capacidades ou identificadores de API. Selecione no seu ambiente os modelos efetivamente disponíveis; nenhuma regra depende de um modelo específico.

## Conteúdo
- CLAUDE.md: instruções permanentes e invariantes.
- docs/01-produto.md: visão, perfis e escopo.
- docs/02-regras.md: regras funcionais numeradas.
- docs/03-fluxos-estados.md: transições e concorrência.
- docs/04-pagamentos.md: carteira, cobrança, liberação e conciliação.
- docs/05-arquitetura.md: proposta técnica e organização.
- docs/06-dados.md: modelo lógico e restrições.
- docs/07-api.md: contrato inicial de operações.
- docs/08-ux.md: telas e estados de interface.
- docs/09-backlog.md: execução incremental.
- docs/10-qualidade-seguranca.md: testes e segurança.
- docs/11-decisoes-pendencias.md: aprovado, proposto e não decidido.
- docs/12-status.md: memória operacional atualizável.
- docs/13-fontes.md: referências técnicas.
- specs/aceitacao.feature: cenários de comportamento para converter em testes.
- specs/politicas.example.json: parâmetros demonstrativos, não tarifas comerciais finais.
- prompts/: instruções de início, revisão e passagem de contexto.
- .env.example e .gitignore: base para configuração segura.
- CONTEXTO_COMPLETO.md: compilação para anexar a um chat.
- MANIFEST.sha256: integridade dos arquivos.

## Convenções
APROVADO = decisão explícita na entrevista.
PROPOSTA = especificação técnica ou sugestão de produto para destravar implementação.
PENDENTE = exige decisão antes da funcionalidade correspondente em produção.
Brasil é a abrangência; horários devem respeitar o fuso do local do serviço, não presumir que todo o país usa São Paulo.


---

# Arquivo: CLAUDE.md

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


---

# Arquivo: docs/01-produto.md

# Visão e escopo
## Problema
Conectar demanda por pequenos serviços presenciais à disponibilidade de trabalhadores informais, com negociação, agenda, confiança e pagamento organizado. Empresas utilizam para trabalhos freelance/pontuais, não como portal de emprego fixo.

## Perfis
Pessoa: contratante e/ou trabalhador na mesma conta, com áreas separadas.
Empresa: contratante via perfil empresarial com CNPJ e aprovação.
Suporte/admin: equipe dos fundadores inicialmente, com gestão de empresas, verificações, denúncias, conflitos, multas e possível banimento.
PROPOSTA: empresa vinculada a um responsável humano verificado; equipes multiusuário ficam para expansão.

## Escopo aprovado
Brasil inteiro; web responsiva mobile-first; PT-BR; moeda BRL.
Cadastro: nome, CPF, telefone, foto e documento; empresa também CNPJ.
Trabalhador sem aprovação manual geral, porém com validação de identidade/telefone; credenciais específicas devem ser verificadas.
Somente maiores de 18 anos.
Perfil com descrição, experiências, portfólio e várias tags.
Chamados urgentes apenas para disponíveis “aberto a trabalho no momento”; reservas futuras conforme agenda.
Requisição com preço sugerido pela plataforma, valor escolhido pelo contratante e contrapropostas.
Chat interno; sem fluxo de compartilhamento de WhatsApp.
Contratante escolhe; pedido permanece aberto durante negociações.
Uma requisição pode ter múltiplas vagas; aceita fechamento com menos pessoas.
Calendário sem sobreposição; sem intervalo obrigatório de deslocamento.
Pix, cartão, carteira e dinheiro físico. Retenção digital até confirmação; saque solicitado.
Trabalhos longos por etapas; hora/diária com fechamento semanal.
Avaliações recíprocas de 1 a 5, comentário opcional, inclusive serviços pagos em espécie.
Bloqueio, denúncia, suporte, multas e análise após três multas válidas em 12 meses.

## Categorias iniciais
Limpeza; pequenos reparos; jardinagem; carga e mudança; eventos/garçom; entregas locais; segurança; transporte particular.
Tags organizam especialidades. Catálogo controlado pelo admin; tags livres/moderação são proposta a decidir.
Entregas: item, retirada, destino e confirmação por código.
Transporte: corridas particulares imediatas/agendadas e trajetos personalizados.
PROPOSTA detalhada de transporte, ainda não ratificada item a item: paradas, retorno, espera, bagagem, acessibilidade, veículo/capacidade, código de embarque e acompanhamento compartilhável.

## Fora da primeira versão
Premium, aplicativos nativos, folha salarial, contratação CLT, seguros próprios, crédito/empréstimo, preços dinâmicos automáticos e algoritmos de IA obrigatórios.
Premium futuro: prioridade para divulgar pedidos ou receber oportunidades compatíveis mais bem remuneradas; não garante renda nem substitui qualificação.

## Métricas propostas
Tempo até primeira proposta; taxa de contratação; conclusão; cancelamento por motivo; disputas; disponibilidade regional; retenção; divergência de conciliação.
Instrumentar agregados sem copiar chat, documentos ou localização exata para analytics.


---

# Arquivo: docs/02-regras.md

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


---

# Arquivo: docs/03-fluxos-estados.md

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


---

# Arquivo: docs/04-pagamentos.md

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


---

# Arquivo: docs/05-arquitetura.md

# Arquitetura proposta
Status: recomendação técnica, não stack escolhida pelo fundador.
Monólito modular TypeScript com Next.js App Router para web e endpoints, PostgreSQL para dados transacionais, extensão geoespacial quando necessária, worker separado para jobs, armazenamento privado compatível com S3 para arquivos. Adotar ORM com migrations e SQL explícito para locks/restrições.
Escolher versões estáveis suportadas na implementação, registrar versões e lockfile; não presumir versões a partir deste documento.

## Módulos
identity, organizations, profiles, catalog, availability, requests, matching, proposals, contracts, chat, execution, payments, wallet, reviews, trust, admin, notifications, transport.
Camadas: domínio puro → serviços de aplicação → repositórios/adaptadores → HTTP/UI.
Nenhuma regra financeira deve existir somente no componente React.
Autenticação por solução mantida, sessões seguras e autorização por recurso no servidor.
Fila durável/outbox em banco inicialmente; infraestrutura adicional só quando necessária.

## Estrutura sugerida
src/app: páginas e adaptadores HTTP.
src/modules/<dominio>: domain, application, infrastructure.
src/components: componentes reutilizáveis.
src/jobs: handlers idempotentes.
tests/unit, integration, e2e.
db/migrations e db/seeds.
Não gerar backend inteiro antes de validar a primeira fatia.

## Geografia e matching
Filtro rígido: categoria, credencial, status/agenda, raio, bloqueio, elegibilidade.
Ordenação proposta: distância, compatibilidade e confiabilidade; novos usuários não excluídos por ausência de nota.
Grupos demonstrativos: 10 candidatos, 60 segundos entre grupos, raio inicial 5km limitado ao raio do profissional; expandir até limite configurado da categoria.
Todos são parâmetros de protótipo, não decisões aprovadas.
Desconexão: heartbeat e expiração de online são propostas; não mostrar indefinidamente disponibilidade abandonada.
Não prometer som/push garantido com navegador fechado: browser, permissões e sistema operacional variam.
Chat via canal autenticado; persistência no servidor e paginação; push só resumo sem dados sensíveis.

## Operação
Separar local, staging e produção; logs estruturados com correlation_id e redaction.
UTC no banco, fuso IANA por serviço, PT-BR na UI, BRL em centavos.
Healthchecks; monitorar falha de jobs, webhook, conciliação e notificações.
Backups criptografados e teste de restauração antes de produção.
Feature flags para transporte/segurança e premium (premium desligado).
Fornecedor de mapa, OTP, KYC e pagamentos substituíveis; mocks explícitos em local.


---

# Arquivo: docs/06-dados.md

# Modelo lógico inicial
UUIDs; created_at/updated_at UTC; version para concorrência otimista onde aplicável. Valores abaixo descrevem entidades, não migrations executáveis.

| Entidade | Campos centrais e relações |
|---|---|
| users | id, nome, telefone, nascimento, status; CPF cifrado e identificador normalizado protegido para unicidade |
| identity_verifications | user_id, provider_ref, status, checked_at; sem documento público |
| organizations / organization_members | CNPJ protegido, nome, approval_status, responsável e papel |
| worker_profiles | user_id único, bio, experiência, raio, online_until, localização privada |
| categories / tags / worker_skills | catálogo, credencial requerida, associações |
| credentials / private_files | dono, tipo, status, expiração, chave privada do arquivo |
| availability_slots | worker_id, intervalo, fuso, tipo disponível/indisponível |
| service_requests | owner_id, organization_id opcional, category_id, tipo, descrição, vagas, status, expires_at, localização aproximada |
| request_locations | request_id, tipo origem/destino/parada, ordem, endereço/coordenadas privados |
| proposals / proposal_versions | request_id, worker_id, versão, moeda, preço, unidade, escopo, status |
| contracts | request_id, worker_id, accepted_version_id, estado, datas, mode digital/cash, policy_snapshot |
| schedule_reservations | worker_id, contract_id, intervalo, expires_at, estado |
| agreement_changes | contract_id, versão base, alterações, aceite de cada parte, funded_status |
| work_units | contract_id, tipo etapa/semana/serviço, escopo, orçamento, status, submitted_at, deadline |
| work_logs | unit_id, autor, data, minutos/diárias, status, versão e evidências |
| conversations / messages | request_id, contratante, candidato; contract_id quando existente, remetente, conteúdo, arquivos |
| payments / provider_events | unit_id, valor, moeda, provider_ref único, status; event_id único |
| ledger_accounts / ledger_transactions / ledger_entries | dono/tipo, moeda, referência, débitos/créditos balanceados |
| refunds / payouts | origem, destino, valor, status, idempotency_key, provider_ref |
| disputes / dispute_events | contrato/unidade, motivo, provas, responsável, resolução, histórico |
| cancellations / penalties | parte responsável, base, percentual, teto, versão da política, motivo, validade |
| reviews | contract_id, author_id, target_id, nota, critérios, comentário, submitted_at, published_at |
| blocks / reports | bloqueador/alvo, motivo, recurso, andamento |
| notification_deliveries / outbox | evento, canal, tentativas, status, scheduled_at, dedupe_key |
| vehicles / transport_details | motorista, documentos privados, capacidade; rota, paradas, espera, passageiros |
| verification_codes | contexto embarque/entrega, hash, expiração, tentativas, consumed_at |
| audit_events / policy_versions | ator, ação, recurso, motivo; parâmetros, vigência |

## Restrições obrigatórias
FKs e índices em referências; preço >=0; moeda BRL; notas 1..5.
unique(contract_id,author_id) em review; autor deve ser uma das duas partes.
unique(provider,event_id), unique(idempotency_scope,key), unique(contract_id,accepted_version_id) conforme operação.
Contrato não pode vincular worker_id=owner_id.
Proteger duplicação de contratação do mesmo trabalhador no mesmo pedido.
Vagas via lock/transação. Agenda via exclusão de intervalos ou mecanismo transacional equivalente.
Ledger: soma débitos=créditos por transação/moeda; lançamentos imutáveis; compensações referenciadas.
Arquivos públicos (portfólio) e privados (identidade) em políticas/buckets distintos.
Chat pré-contrato possui ACL restrita ao candidato e solicitante, não aos demais candidatos.
Suporte acessa conteúdo sensível somente por caso e permissão auditada.

## Retenção
Prazos de documentos, mensagens, geolocalização e finanças pendentes de definição.
Não apagar evidências financeiras para atender exclusão de perfil sem política de retenção; implementar anonimização/limitação compatíveis com a política aprovada.
Nenhum dado real nos seeds.


---

# Arquivo: docs/07-api.md

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


---

# Arquivo: docs/08-ux.md

# Telas e experiência
Nome provisório neutro. Design mobile-first, alto contraste, tipografia legível, foco visível, formulários rotulados, estados anunciáveis por leitor de tela. Não depender só de cor, mapa ou som.

## Navegação
Seletor “Contratar / Trabalhar” na mesma conta.
Contratante: início, meus pedidos, agenda, mensagens, carteira, perfil.
Trabalhador: disponibilidade, chamados, trabalhos, agenda, ganhos/carteira, perfil.
Suporte separado e protegido.

## Telas prioritárias
1. Cadastro e verificação: pessoa/empresa; estado pendente, falhou e aprovado; orientar dados faltantes.
2. Perfil profissional: bio, serviços/tags, experiência, portfólio e reputação publicada.
3. Criar pedido: categoria → descrição/local → urgente/agendado → vagas → preço/unidade → revisão.
4. Pedido aberto: propostas, versões, chat, tempo até expiração, renovar/ajustar.
5. Aprovar profissional: escopo, preço individual, calendário, pagamento, regras de cancelamento.
6. Execução: aprovado, deslocamento, iniciado, concluir; etapas e registros para longos.
7. Conclusão: resumo do trabalho e dinheiro, confirmar ou contestar, prazo 24h.
8. Carteira: disponível, retido, saques e débitos separados; extrato legível por serviço.
9. Avaliar: 1–5, critérios e comentário opcionais; “Sua avaliação será publicada quando ambos avaliarem”.
10. Suporte: ticket com histórico, provas, status e resolução.
11. Transporte: origem/destino/paradas, passageiros e veículo, conforme habilitação.
12. Admin: filas de empresas/credenciais, disputas, multas, denúncias, conciliação e políticas.

## Estados obrigatórios
Carregando, vazio, sem profissionais na região, sem permissão de localização, offline, erro recuperável, conflito de vaga, proposta desatualizada, pagamento pendente/falhou, prazo expirado.
Não mostrar “contratado” antes do passo de confirmação correspondente.
Separar valores por trabalhador do total de pedido.
Antes de cancelar, exibir taxa, destinatário e crédito restante.
Configuração de taxas nunca oculta da parte afetada.

## Comunicação
Chat só dentro do produto; anexos com limites, antivírus/validação e acesso privado.
Notificações de chamado, proposta, contratação, alteração, início, conclusão, disputa, saque e expiração.
Permissão de push solicitada no momento útil; fallback em caixa de notificações.
Mapa não pode revelar residência exata de candidato nem endereço do pedido antes da contratação.
Compartilhamento de trajeto é proposta futura da categoria: token revogável/expirável, sem tornar perfil e documentos públicos.


---

# Arquivo: docs/09-backlog.md

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


---

# Arquivo: docs/10-qualidade-seguranca.md

# Qualidade e segurança
## Testes prioritários
Unitários: cálculo em centavos; teto/percentual; horário-limite; contagem móvel 12 meses; tarifa/minutos; validação de transições.
Integração com banco real de teste: última vaga concorrente; sobreposição; dois saques; double webhook; liberação vs disputa; rollback e outbox.
E2E: cadastro → pedido → proposta → aprovação → pagamento mock → execução → conclusão → saldo → saque mock; cancelamento; espécie; duas avaliações.
Não confundir sucesso visual com persistência ou autorização.

## Critérios verificáveis
- Usuário A não lê chat, documento, extrato ou endereço privado de B sem relação autorizada.
- Conta gratuita elegível continua recebendo chamados; premium desligado não afeta algoritmo.
- Profissional novo sem notas não é eliminado.
- Alterar preço no frontend não modifica valor cobrado.
- 23h59 após conclusão não libera automaticamente; após 24h pode liberar se condições válidas.
- Uma só avaliação não altera nota pública.
- Cancelar uma vaga preserva contratos das demais.
- Saldo negativo por dívida não autoriza saque.
- Repetir qualquer evento financeiro não duplica efeito.
- Documento não servido por URL pública permanente.
- Todas as ações de suporte sensíveis têm ator e motivo.

## Segurança
Senha/sessão com biblioteca mantida; rate limiting de login, OTP, chat e propostas.
Reautenticação para trocar conta de saque; MFA para suporte é proposta técnica.
RBAC + autorização por recurso; memberships empresariais explícitas.
Uploads: tipo/tamanho, assinatura real do arquivo, malware e URL temporária.
Cifrar dados sensíveis, TLS, secrets fora de repositório; redigir CPF, tokens e coordenadas em logs.
Proteção contra XSS, CSRF, SQL injection, enumeração, upload malicioso e abuso de websocket.
Código embarque/entrega com hash, expiração, limite de tentativas e uso único.
Taxas, alterações e decisões de suporte auditáveis e versionadas.
Threat model mínimo: fraude em conclusão, falso deslocamento, chargeback, documentos falsos, apropriação de conta, assédio, vazamento de endereço.

## Privacidade/operacional
Minimizar documentos armazenados; preferir referência de verificação do provedor quando possível.
Definir política de retenção e solicitações de dados antes de produção.
Localização apenas para finalidade autorizada; acompanhamento não habilitado permanentemente por padrão.
A plataforma não deve tratar “botão suporte” como serviço de emergência garantido.
Verificar requisitos de transporte, segurança e processamento financeiro antes de habilitar operação real; este pacote não certifica conformidade.

## Metas propostas
Nenhum vazamento horizontal nos testes; zero divergência contábil nos cenários de teste.
Acessibilidade móvel/teclado e baixo consumo de dados como metas qualitativas iniciais.
Definir SLOs de latência/uptime após escolher hospedagem e medir baseline, sem prometer escala não testada.


---

# Arquivo: docs/11-decisoes-pendencias.md

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


---

# Arquivo: docs/12-status.md

# Status e passagem de contexto
Data: 2026-11-15
Estado: documentação inicial concluída; aplicação NÃO implementada.
Stack: proposta, ainda sem bootstrap.
Testes da aplicação: não executados; não existe código executável do produto neste pacote.
Integrações: nenhuma contratada/configurada.
Próxima tarefa: prompts/01-iniciar.md, B01 e primeira fatia B02–B04.

## Atualizar ao encerrar cada sessão
- Data, modelo efetivamente usado e tarefa:
- Commit/base:
- Entregas concluídas e arquivos:
- Decisões novas (aprovadas/propostas):
- Comandos e resultados reais:
- Falhas/limitações conhecidas:
- Migrations/seeds:
- Próximo passo único:
- Pendências que bloqueiam só produção:
- Mudanças locais a preservar:

Não substituir evidência por “funciona”. Anotar se teste usou mock ou provedor sandbox.


---

# Arquivo: docs/13-fontes.md

# Referências e limites
Fonte primária de requisitos: entrevista nesta conversa, consolidada em 15/11/2026.
Documentação técnica consultada em 15/11/2026:
- Claude, contexto e CLAUDE.md: https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts
- Next.js App Router: https://nextjs.org/docs/app
- PostgreSQL, isolamento de transações: https://www.postgresql.org/docs/current/transaction-iso.html
Referência de produto consultada durante entrevista:
- BlaBlaCar, seção 7 de cancelamento: https://legal.blablacar.com/pt-br/terms-and-conditions/
A política sugerida para este marketplace é própria; não copiar termos de carona como política jurídica de serviços.
Modelos citados pelo usuário não tiveram disponibilidade ou capacidades verificadas; usar seletor do ambiente.
Frameworks são propostas. Consultar documentação oficial atual antes de instalar dependências e fixar versões.


---

# Arquivo: prompts/01-iniciar.md

Leia CLAUDE.md, README.md e todos os documentos em docs antes de alterar o repositório. Use as decisões aprovadas como fonte de verdade e mantenha propostas/pendências identificadas.

Quero começar o desenvolvimento real desta plataforma em um repositório local. Inspecione arquivos existentes para não sobrescrever trabalho. Se não houver aplicação, adote a arquitetura proposta, verificando versões atuais estáveis e criando lockfile. Não bloqueie por nome, cores, fornecedor ou tarifas: use placeholders e adaptadores mock claramente identificados.

Implemente B01 e uma primeira fatia B02–B04: pessoa com áreas contratante/trabalhador, perfis, categoria limpeza, disponibilidade, publicação de pedido urgente, proposta/contraproposta versionada e chat restrito aos participantes. Use persistência real local, migrations e seeds fictícios. Depois valide o fluxo antes de avançar para pagamentos.

Entregue instruções reproduzíveis para iniciar o ambiente, comandos de testes executados e limitações. Não implemente toda a plataforma superficialmente numa única sessão. Não anuncie pagamentos/identidade como reais. Atualize docs/12-status.md e registre decisões técnicas. Se aparecer bloqueio de negócio, isole o módulo e continue o restante autorizado.


---

# Arquivo: prompts/02-revisar.md

Atue como revisor da implementação existente. Leia CLAUDE.md, docs/02-regras.md, docs/03-fluxos-estados.md, docs/04-pagamentos.md, specs/aceitacao.feature e docs/12-status.md.

Compare o código e os testes com os requisitos. Priorize: autorização por recurso, dados privados, aprovação pelo contratante, última vaga concorrente, conflito de agenda, dinheiro em centavos, ledger balanceado, idempotência de webhook/saque/liberação, contestação antes das 24h e avaliações bilaterais.

Relate achados com severidade, arquivo, reprodução, impacto e correção. Não invente falhas nem resultados. Corrija problemas comprovados dentro da tarefa, adicione testes de regressão úteis e execute os comandos disponíveis. Preserve decisões aprovadas. Não habilite produção nem movimentos reais de dinheiro. Atualize o status com evidências e próximo passo.


---

# Arquivo: prompts/03-handoff.md

Vou continuar este projeto com outro modelo. Leia CLAUDE.md e docs/12-status.md; depois confira o estado real do repositório, diff e testes.

Não presuma que tudo do backlog foi implementado. Identifique a última fatia completa, pendências, mudanças locais e decisões ainda propostas. Continue o próximo passo registrado. Mantenha os contratos de API e invariantes financeiros. Antes de mudar arquitetura, explique a necessidade e registre a decisão.

Ao encerrar, atualize status com arquivos, testes reais, limitações e próximo passo. “Fable 5.2” e “Opus 5.5” são rótulos fornecidos pelo usuário, não dependências de código. A divisão sugerida é implementação por um modelo e revisão pelo outro, sem pressupor capacidades específicas.


---

# Arquivo: specs/aceitacao.feature

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


---

# Arquivo: specs/politicas.example.json

{
  "schemaVersion": 1,
  "status": "draft_not_for_production",
  "currency": "BRL",
  "approved": {
    "requestExpiryHours": 3,
    "completionConfirmationHours": 24,
    "penaltyReviewCount": 3,
    "penaltyLookbackCalendarMonths": 12,
    "scheduledFreeCancellationBeforeHours": 24,
    "scheduledBookingGraceMinutes": 30,
    "noShowWaitMinutes": 15,
    "reviewsRequireBoth": true,
    "travelBufferMinutes": 0,
    "premiumEnabled": false,
    "physicalCashEnabled": true
  },
  "proposed": {
    "cancellationPenaltyBps": 1000,
    "cancellationCapCents": 10000,
    "noShowPenaltyBps": 2000,
    "noShowCapCents": 20000,
    "fundingReservationMinutes": 15,
    "matchingBatchSize": 10,
    "matchingBatchIntervalSeconds": 60,
    "matchingInitialRadiusKm": 5
  },
  "undecided": {
    "platformFeeBps": null,
    "paymentProvider": null,
    "payoutFees": null,
    "payoutMinimumCents": null,
    "retentionDays": null
  }
}
