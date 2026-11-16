# Plataforma de serviços presenciais
Nome comercial não definido • Português do Brasil.

Este repositório contém a especificação (docs/, specs/, prompts/) **e um protótipo funcional** do marketplace. O protótipo roda localmente com **pagamentos, saques, SMS e verificação de identidade SIMULADOS**: não movimenta dinheiro real, não está pronto para produção e recusa iniciar em `APP_ENV=production`. O estado exato do que existe e do que falta está em `docs/12-status.md`.

## Executar localmente
Requisito: Node.js 22 ou mais novo (desenvolvido com Node 26). Não precisa instalar banco de dados nem Docker.

```
npm install
npm run dev
```
Abra http://localhost:3000. Na primeira subida o servidor cria o banco em `~/.plataforma-servicos/pgdata` (fora do projeto), aplica as migrations e cadastra contas **fictícias** (senha `demo1234`):

| Conta | Papel |
|---|---|
| carla@demo.invalid | contratante |
| joao@demo.invalid, maria@demo.invalid | trabalhadores validados (limpeza; Maria também faz reparos) |
| suporte@demo.invalid | suporte/admin (painel em /admin) |

Roteiro sugerido (use duas janelas, uma anônima): Carla cria e publica um pedido urgente de limpeza em São Paulo → João, em “Trabalhar”, vê o chamado, propõe outro valor e conversa pelo chat → Carla aprova e paga pelo provedor simulado → João registra deslocamento, início e conclusão → Carla confirma (ou contesta) → os dois se avaliam → João saca em Carteira e o suporte conclui o saque em /admin.

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento, com jobs em processo (expirações, prazo de 24h, grupos de matching) |
| `npm test` | testes unitários e de integração em banco real em memória (cenários de `specs/aceitacao.feature`) |
| `npm run typecheck` | verificação de tipos |
| `npm run check` | typecheck + testes |
| `npm run build` | build de produção do Next.js (o servidor resultante ainda recusa `APP_ENV=production`) |
| `npm run smoke` | teste de fumaça HTTP de ponta a ponta contra o servidor local em execução com o seed |
| `npm run db:reset` | apaga o banco local (pare o servidor antes); a próxima subida recria tudo |

## Organização do código
- `db/migrations/` — esquema PostgreSQL versionado; `db/seeds/` — dados fictícios.
- `src/lib/` — banco, relógio, dinheiro em centavos, tempo/fuso, criptografia, configuração.
- `src/modules/` — regras de negócio e autorização (identity, profiles, requests, proposals, chat, contracts, settlement, cancellations, payments, gateway, ledger, wallet, reviews, trust, admin, jobs).
- `src/app/` — páginas (Next.js App Router), `actions.ts` (formulários) e `api/v1` (API REST e webhook).
- `tests/` — testes; `scripts/` — utilitários.

Nenhuma regra financeira ou permissão vive na interface: páginas e API apenas chamam os serviços de `src/modules`.

---

# Pacote de contexto original
Versão 1.0 • 15/11/2026. A especificação abaixo foi consolidada da entrevista com o fundador. Não contém credenciais, integrações contratadas ou alegação de conformidade jurídica.

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
