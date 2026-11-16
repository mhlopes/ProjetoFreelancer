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
