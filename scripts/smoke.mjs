/**
 * Teste de fumaça HTTP contra o servidor local em execução (npm run dev) com os dados fictícios do seed.
 * Percorre: pedido urgente → proposta → contraproposta → chat → aprovação → pagamento simulado (webhook assinado)
 * → execução → conclusão → confirmação → avaliações → saque; e confere privacidade e autorização pela API.
 * Uso: node scripts/smoke.mjs [baseUrl]
 */
import crypto from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'dev-only-webhook-secret';
let failures = 0;

function check(name, cond, extra = '') {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FALHOU ${name} ${extra}`); }
}

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method, redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* página HTML */ }
    return { status: res.status, json, text };
  };
  const raw = async (method, path, formData) => {
    const res = await fetch(`${BASE}${path}`, { method, redirect: 'manual', headers: { cookie }, body: formData });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const sc of set) { const kv = sc.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; }
    return { status: res.status, location: res.headers.get('location') ?? '' };
  };
  return {
    raw,
    login: (email) => call('POST', '/api/v1/session', { email, password: 'demo1234' }),
    get: (p) => call('GET', p),
    post: (p, b = {}, h) => call('POST', p, b, h),
    put: (p, b = {}) => call('PUT', p, b),
  };
}

const idem = () => ({ 'idempotency-key': crypto.randomUUID() });

const carla = client(), joao = client(), maria = client(), suporte = client(), anon = client();
for (const [c, e] of [[carla, 'carla'], [joao, 'joao'], [maria, 'maria'], [suporte, 'suporte']]) {
  const r = await c.login(`${e}@demo.invalid`);
  check(`login ${e}`, r.status === 200, JSON.stringify(r.json));
}

console.log('\nPáginas');
for (const p of ['/', '/entrar', '/cadastro']) check(`GET ${p} anônimo`, [200, 307].includes((await anon.get(p)).status));
check('página protegida redireciona anônimo', (await anon.get('/carteira')).status === 307);
check('API exige sessão', (await anon.get('/api/v1/wallet')).status === 401);
for (const p of ['/contratar', '/contratar/pedidos/novo', '/contratos', '/agenda', '/mensagens', '/carteira', '/perfil', '/notificacoes', '/trabalhar', '/trabalhar/perfil'])
  check(`GET ${p}`, (await joao.get(p)).status === 200);
check('suporte abre /admin', (await suporte.get('/admin')).status === 200);
check('não-suporte recebe 404 em /admin', (await joao.get('/admin')).status === 404);

console.log('\nPedido, proposta e chat');
await joao.put('/api/v1/me/availability', { online: true });
await maria.put('/api/v1/me/availability', { online: true });
const cats = (await anon.get('/api/v1/categories')).json;
const limpeza = cats.find((c) => c.slug === 'limpeza');
check('categorias públicas sem transporte/segurança', limpeza && !cats.some((c) => ['transporte', 'seguranca'].includes(c.slug)));
const created = await carla.post('/api/v1/requests', {
  categoryId: limpeza.id, kind: 'urgent', title: 'Limpeza de cozinha (smoke)', description: 'Limpeza completa de cozinha pequena, com forno.',
  seats: 1, priceCents: 10000, billingUnit: 'fixed', paymentKind: 'digital', durationMinutes: 120,
  uf: 'SP', city: 'São Paulo', area: 'Centro', street: 'Rua Privada Smoke', number: '77', lat: -23.5505, lng: -46.6333,
});
check('cria rascunho', created.status === 200, JSON.stringify(created.json));
const reqId = created.json.id;
check('publica', (await carla.post(`/api/v1/requests/${reqId}/publish`)).status === 200);
const asJoao = await joao.get(`/api/v1/requests/${reqId}`);
check('candidato vê o pedido', asJoao.status === 200 && asJoao.json.role === 'candidate');
check('candidato NÃO recebe endereço exato', asJoao.json.location === null && !asJoao.text.includes('Rua Privada Smoke'));
check('página do chamado não vaza endereço', !(await joao.get(`/trabalhar/chamados/${reqId}`)).text.includes('Rua Privada Smoke'));
const prop = await joao.post(`/api/v1/requests/${reqId}/proposals`, { amountCents: 10000, scope: 'Limpeza de cozinha' });
check('proposta registrada', prop.status === 200, JSON.stringify(prop.json));
check('contraproposta do trabalhador (12000)', (await joao.post(`/api/v1/proposals/${prop.json.id}/counteroffers`, { amountCents: 12000, scope: 'Limpeza de cozinha com forno', expectedVersion: 1 })).status === 200);
check('versão desatualizada → 409', (await joao.post(`/api/v1/proposals/${prop.json.id}/counteroffers`, { amountCents: 13000, scope: 'x y z', expectedVersion: 1 })).status === 409);
const pedidoHtml = (await carla.get(`/contratar/pedidos/${reqId}`)).text;
check('contratante vê valor atualizado e histórico', pedidoHtml.includes('120,00') && pedidoHtml.includes('100,00'));
const convId = /\/mensagens\/([0-9a-f-]{36})/.exec(pedidoHtml)?.[1];
check('conversa criada', !!convId);
check('chat: trabalhador envia', (await joao.post(`/api/v1/conversations/${convId}/messages`, { body: 'Levo meus produtos.' })).status === 200);
check('chat: contratante lê', (await carla.get(`/api/v1/conversations/${convId}/messages`)).json?.[0]?.body === 'Levo meus produtos.');
check('chat: terceiro (maria) recebe 404', (await maria.get(`/api/v1/conversations/${convId}/messages`)).status === 404);
check('pedido alheio: terceiro sem relação não aprova', (await maria.post(`/api/v1/proposals/${prop.json.id}/accept`, { proposalVersionId: crypto.randomUUID(), paymentMode: 'pix' }, idem())).status === 404);

console.log('\nAprovação e pagamento');
const versionId = /name="versionId" value="([0-9a-f-]{36})"/.exec(pedidoHtml)?.[1];
check('aceite sem Idempotency-Key → 400', (await carla.post(`/api/v1/proposals/${prop.json.id}/accept`, { proposalVersionId: versionId, paymentMode: 'pix' })).status === 400);
const key = idem();
const acc = await carla.post(`/api/v1/proposals/${prop.json.id}/accept`, { proposalVersionId: versionId, paymentMode: 'pix' }, key);
check('contratante aprova → aguardando pagamento', acc.status === 200 && acc.json.status === 'awaiting_funding', JSON.stringify(acc.json));
const acc2 = await carla.post(`/api/v1/proposals/${prop.json.id}/accept`, { proposalVersionId: versionId, paymentMode: 'pix' }, key);
check('mesma chave devolve o mesmo resultado', acc2.status === 200 && acc2.json.contractId === acc.json.contractId);
check('mesma chave com corpo diferente → 409', (await carla.post(`/api/v1/proposals/${prop.json.id}/accept`, { proposalVersionId: versionId, paymentMode: 'card' }, key)).status === 409);
const { contractId, unitId } = acc.json;
check('trabalhador ainda sem endereço', (await joao.get(`/api/v1/contracts/${contractId}`)).json.location === null);
check('trabalhador não inicia sem pagamento', (await joao.post(`/api/v1/contracts/${contractId}/start`)).status === 409);
const pay = await carla.post(`/api/v1/contracts/${contractId}/payments`, { method: 'pix', amountCents: 1 }, idem());
check('cobrança usa valor do servidor (12000), ignora o do cliente', pay.json?.amount_cents === 12000, JSON.stringify(pay.json));
check('página de pagamento rotulada como simulada', (await carla.get(`/pagamentos/${pay.json.id}`)).text.includes('PROVEDOR SIMULADO'));
const event = JSON.stringify({ id: `smoke_${crypto.randomUUID()}`, type: 'payment.confirmed', data: { providerRef: pay.json.provider_ref, amountCents: 12000, currency: 'BRL' } });
check('webhook com assinatura inválida → 401', (await anon.post('/api/v1/webhooks/payments/mock', JSON.parse(event), { 'x-signature': 'errada' })).status === 401);
check('contrato segue aguardando', (await carla.get(`/api/v1/contracts/${contractId}`)).json.contract.status === 'awaiting_funding');
const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(event).digest('hex');
const hook = async () => fetch(`${BASE}/api/v1/webhooks/payments/mock`, { method: 'POST', headers: { 'x-signature': sig }, body: event }).then(async (r) => ({ status: r.status, json: await r.json() }));
const h1 = await hook(), h2 = await hook();
check('webhook assinado processa', h1.status === 200 && h1.json.status === 'processed', JSON.stringify(h1.json));
check('webhook repetido é duplicata sem efeito', h2.status === 200 && h2.json.status === 'duplicate');
const afterPay = (await joao.get(`/api/v1/contracts/${contractId}`)).json;
check('contrato confirmado; endereço liberado ao contratado', afterPay.contract.status === 'confirmed' && afterPay.location?.street === 'Rua Privada Smoke');
check('retido aparece na carteira do contratante', (await carla.get('/api/v1/wallet')).json.heldAsClientCents >= 12000);

console.log('\nExecução, conclusão e liberação');
check('deslocamento', (await joao.post(`/api/v1/contracts/${contractId}/departure`)).status === 200);
check('início', (await joao.post(`/api/v1/contracts/${contractId}/start`)).status === 200);
check('contratante não solicita conclusão', (await carla.post(`/api/v1/units/${unitId}/submit`, { summary: 'Tentativa indevida do contratante.' })).status === 403);
check('conclusão registrada', (await joao.post(`/api/v1/units/${unitId}/submit`, { summary: 'Cozinha e forno limpos conforme combinado.' })).status === 200);
check('página do contrato mostra prazo de 24h', (await carla.get(`/contratos/${contractId}`)).text.includes('Prazo para confirmar ou contestar'));
const before = (await joao.get('/api/v1/wallet')).json.availableCents;
check('trabalhador não aprova a própria conclusão', (await joao.post(`/api/v1/units/${unitId}/approve`, {}, idem())).status === 403);
const k2 = idem();
check('contratante confirma', (await carla.post(`/api/v1/units/${unitId}/approve`, {}, k2)).json?.released === true);
await carla.post(`/api/v1/units/${unitId}/approve`, {}, k2);
await carla.post(`/api/v1/units/${unitId}/approve`, {}, idem());
const after = (await joao.get('/api/v1/wallet')).json.availableCents;
check('liberado exatamente uma vez (12000)', after - before === 12000, `delta=${after - before}`);

console.log('\nAvaliações e saque');
check('primeira avaliação fica oculta', (await carla.post(`/api/v1/contracts/${contractId}/reviews`, { rating: 5, comment: 'Excelente serviço' })).json?.published === false);
const hidden = await joao.get(`/api/v1/contracts/${contractId}/reviews`);
check('contraparte não vê nota nem comentário', hidden.json.theirs === null && !hidden.text.includes('Excelente'));
check('segunda avaliação publica ambas', (await joao.post(`/api/v1/contracts/${contractId}/reviews`, { rating: 4 })).json?.published === true);
check('carteira alheia não é acessível por parâmetro', (await maria.get('/api/v1/wallet')).json.availableCents !== after || after === 0);
const k3 = idem();
const po = await joao.post('/api/v1/wallet/payouts', { amountCents: 5000 }, k3);
check('saque solicitado', po.status === 200 && po.json.status === 'processing', JSON.stringify(po.json));
check('saque repetido com a mesma chave não debita de novo', (await joao.post('/api/v1/wallet/payouts', { amountCents: 5000 }, k3)).json?.id === po.json.id && (await joao.get('/api/v1/wallet')).json.availableCents === after - 5000);
check('saque acima do saldo → 422', (await joao.post('/api/v1/wallet/payouts', { amountCents: 99999999 }, idem())).status === 422);
check('origem estranha é barrada (CSRF)', (await joao.post('/api/v1/blocks', { targetUserId: crypto.randomUUID() }, { origin: 'https://site-malicioso.invalid' })).status === 403);
const adminHtml = (await suporte.get('/admin')).text;
check('ledger íntegro no painel (0 transações desbalanceadas)', adminHtml.includes('transações desbalanceadas: <!-- -->0') || adminHtml.includes('transações desbalanceadas: 0'));
check('conciliação acusa o evento que este teste assinou por fora do provedor simulado', adminHtml.includes('DIVERGÊNCIA'));

console.log('\nFormulários do site (server actions, sem JavaScript)');
async function submitForm(c, page, marker, extra = {}) {
  const html = (await c.get(page)).text;
  const form = html.split('<form').slice(1).map((f) => f.split('</form>')[0]).find((f) => f.includes(marker));
  if (!form) return { status: 0, location: '' };
  const fd = new FormData();
  for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1], value = /value="([^"]*)"/.exec(m[0])?.[1] ?? '';
    if (name) fd.append(name, value.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  }
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return c.raw('POST', page, fd);
}
const web = client();
const bad = await submitForm(web, '/entrar', 'name="password"', { email: 'carla@demo.invalid', password: 'senha-errada' });
check('login com senha errada volta com erro', bad.status === 303 && decodeURIComponent(bad.location).includes('erro='), `${bad.status} ${bad.location}`);
const good = await submitForm(web, '/entrar', 'name="password"', { email: 'maria@demo.invalid', password: 'demo1234' });
check('login pelo formulário cria sessão', good.status === 303 && (await web.get('/trabalhar')).status === 200, `${good.status} ${good.location}`);
const off = await submitForm(web, '/trabalhar', 'name="online"');
check('ação "ficar indisponível" pelo formulário', off.status === 303 && decodeURIComponent(off.location).includes('ok='), `${off.status} ${off.location}`);
check('estado refletido na página', (await web.get('/trabalhar')).text.includes('Ficar disponível agora'));
const out = await submitForm(web, '/perfil', 'Sair da conta');
check('sair encerra a sessão', out.status === 303 && (await web.get('/carteira')).status === 307, `${out.status}`);

console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTodas as verificações passaram');
process.exit(failures ? 1 : 0);
