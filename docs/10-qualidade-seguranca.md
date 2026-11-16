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
