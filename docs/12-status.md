# Status e passagem de contexto
Data: 2026-11-15
Estado: **protótipo funcional local** cobrindo o fluxo principal de ponta a ponta com adaptadores SIMULADOS. Não é produto completo e não está pronto para movimentar dinheiro real; a aplicação recusa iniciar com `APP_ENV=production`.
Stack efetiva: Node 26.13.1 · Next.js 16.4.6 (App Router, Turbopack) · React 19.3.1 · TypeScript 7.0.2 · PostgreSQL embarcado via PGlite 0.5.16 · Vitest 5.1.0. Versões fixadas em `package-lock.json`.
Integrações: nenhuma contratada. Pagamentos, saques, OTP e verificação de identidade são mocks rotulados na interface.

## Sessão 2026-11-15 — Claude Fable 5.2 (claude-fable-5-2)
- Tarefa: construir a aplicação a partir do pacote de contexto, tratando a especificação técnica como sugestão e seguindo à risca as regras de negócio.
- Commit/base: repositório git inicializado (`git init`), **sem commits** — nada foi commitado.
- Ambiente: Node.js LTS instalado na máquina via winget (não havia nenhum runtime).

### Entregue (backlog)
| Item | Situação |
|---|---|
| B01 Fundação | Feito: app, migrations, seed fictício, mocks explícitos, CI (`.github/workflows/ci.yml`, **nunca executada**), README de execução |
| B02 Contas e permissões | Feito: cadastro (18+, CPF cifrado + índice cego), login, dois modos na mesma conta, autorização por recurso nos serviços, empresa com aprovação do suporte. Sem foto/upload de documento |
| B03 Catálogo/perfil/disponibilidade | Feito: categorias e tags controladas, perfil profissional, raio, “aberto a trabalho” com expiração, períodos indisponíveis, verificação mock controla elegibilidade. Sem portfólio |
| B04 Pedido/proposta/chat | Feito: rascunho → publicar, expiração em 3h, renovar, ajustar valor, propostas e contrapropostas versionadas, chat restrito, endereço redigido |
| B05 Contrato e calendário | Feito: aprovação só pelo contratante, N vagas → N contratos, trava de vaga, agenda sem sobreposição (constraint de exclusão), reserva de 15 min |
| B06 Pix simulado e ledger | Feito: gateway mock, webhook com assinatura HMAC, evento único por provedor, ledger imutável e balanceado, pagamento tardio → conciliação → crédito |
| B07 Execução e conclusão | Feito: deslocamento, início, conclusão, confirmação ou 24h, contestação bloqueia, resolução pelo suporte |
| B08 Carteira/cancelamento/saque | Feito: carteira derivada do ledger, cancelamento com prévia, multa/compensação, dívida separada, saque idempotente, conciliação mock |
| B09 Avaliações e proteção | Feito: publicação bilateral atômica, reputação por papel, bloqueio, denúncia |
| B10 Etapas/horas/diárias | **Parcial**: só cobrança por hora em unidade única (registro de minutos, teto financiado, correção pelo contratante). Faltam etapas, fechamento semanal, diárias e alterações de acordo (change orders) |
| B11 Matching e notificações | **Parcial**: grupos progressivos com dedupe e caixa de avisos interna. Sem push, sem heartbeat por atividade |
| B12 Painel de suporte | **Parcial**: empresas, disputas, multas (anular), análise de 3 multas, denúncias, conciliação, auditoria, console do provedor simulado. Sem fila de credenciais, sem MFA |
| B13 Entregas/transporte/segurança | Não feito. Categorias existem desligadas por flag; a API recusa contratação |
| B14 Integrações reais e hardening | Não feito |
| B15 Premium | Fora do escopo (desligado) |

### Arquivos
`db/migrations/0001_schema.sql`, `0002_reference_data.sql`; `db/seeds/demo.ts`; `src/lib/*`; `src/modules/*` (regras); `src/app/*` (páginas, `actions.ts`, `api/v1`, `api/health`); `src/components/*`; `src/instrumentation.ts`; `tests/*`; `scripts/smoke.mjs`, `scripts/db-reset.ts`.
Alterados do pacote original: `README.md`, `.env.example`, `.gitignore`, `docs/11-decisoes-pendencias.md`, este arquivo. **Não regenerados:** `CONTEXTO_COMPLETO.md` e `MANIFEST.sha256` continuam refletindo o pacote original (os hashes dos arquivos alterados não conferem mais).

### Decisões novas
Todas PROPOSTAS técnicas, nenhuma aprovada pelo fundador: T01–T20 e pendências O13–O15 em `docs/11-decisoes-pendencias.md`. As mais relevantes para revisar: T01 (banco embarcado), T06 (duas contas na carteira), T09 (regra de cancelamento do trabalhador), T11 (ausência em urgentes).

### Comandos executados e resultados reais
| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | sem erros |
| `npm test` (Vitest, PGlite em memória) | 3 arquivos, **73 testes passaram, 1 pendente (todo)**, ~70 s |
| `npx next build` | compilou; 24 rotas dinâmicas |
| `npm run dev` + `node scripts/smoke.mjs` | **73 verificações passaram**, em três execuções seguidas sobre banco recém-criado |

O que os testes cobrem: 22 dos 23 cenários de `specs/aceitacao.feature` (o de “etapa contestada não contamina outras” está como `todo`, pois etapas não existem ainda), mais unitários de dinheiro, tempo, documentos e regras de cancelamento. Tudo com gateway **mock**; nenhum provedor sandbox foi usado.
O teste de fumaça usa a API REST e envia formulários do site sem JavaScript (login, ação autenticada, sair).

### Limitações conhecidas
- **Nenhum teste em navegador real.** As telas foram verificadas por HTTP (status 200, conteúdo e envio de formulários), não por inspeção visual nem leitor de tela. Layout, responsividade e acessibilidade ainda precisam de revisão humana.
- Concorrência: o PGlite serializa transações. Os testes “simultâneos” provam que só um vence, mas não exercitam disputa real de locks entre conexões de um PostgreSQL servidor.
- Formulário com erro de validação volta vazio (os dados digitados não são preservados).
- Chat e telas atualizam por recarga periódica (5–10 s), não por canal em tempo real. Sem anexos.
- Sem upload de arquivos: foto, documento, portfólio e evidências de conclusão (a evidência mínima hoje é o resumo em texto).
- Geografia: sem mapas nem geocodificação; distância só quando os dois lados informam localização pelo navegador, senão mesma cidade/UF.
- Saque: sem conta de destino nem reautenticação; o mock paga quando o suporte clica no console.
- Rate limiting simples por janela fixa (login, OTP, chat, propostas, denúncias); a contagem feita dentro de transação desfeita não persiste.
- O gateway é chamado dentro da transação ao criar cobrança (inofensivo no mock; rever com provedor real).
- Sem outbox para integrações externas; notificações são apenas a caixa interna.
- Reembolso sempre em crédito de carteira (O03); chargeback de cartão não modelado.
- CPFs dos seeds e testes são sintéticos (dígitos verificadores calculados sobre base sequencial), e-mails em `.invalid`.
- `next dev` gera `AGENTS.md` na raiz (arquivo do próprio Next.js).

### Migrations/seeds
Migrations aplicadas automaticamente na subida (`schema_migrations`). Seed fictício só em `APP_ENV=development` e só com a tabela de usuários vazia. `npm run db:reset` apaga `~/.plataforma-servicos/pgdata`.

### Próximo passo único
Revisão humana das telas no navegador seguindo o roteiro do README e ratificação (ou correção) de T06, T09 e T11. Em seguida, B10 completo: etapas com financiamento individual, alterações de acordo versionadas e fechamento semanal — o que também destrava o cenário de aceitação pendente.

### Pendências que bloqueiam só produção
O01–O12 do pacote original e O13–O15; servidor PostgreSQL real com teste de concorrência entre conexões; provedores reais (pagamento, KYC, OTP, mapas, push); armazenamento privado de arquivos; autenticação reforçada do suporte; backups e restauração; observabilidade; política de retenção e termos.

### Mudanças locais a preservar
Banco local em `~/.plataforma-servicos/pgdata` (fora do projeto; ficava em `.data/` e causava recarga infinita no `next dev`). Nenhuma alteração do usuário foi sobrescrita: o repositório só continha o pacote de contexto.

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
