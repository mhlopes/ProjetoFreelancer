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
