import { requireActor } from '@/lib/session';
import { formatBRL } from '@/lib/money';
import { UFS } from '@/lib/time';
import { listMyOrganizations } from '@/modules/identity';
import { listCategories, listTags } from '@/modules/profiles';
import { GeoFields, Submit } from '@/components/client';
import { Back } from '@/components/ui';
import { createRequestAction } from '../../../actions';

export default async function NovoPedido() {
  const { actor } = await requireActor();
  const [categories, tags, orgs] = await Promise.all([listCategories(), listTags(), listMyOrganizations(actor)]);
  const approvedOrgs = orgs.filter((o) => o.approval_status === 'approved');
  return (
    <>
      <h1>Novo pedido</h1>
      <form action={createRequestAction}>
        <Back to="/contratar/pedidos/novo" />
        <section className="card">
          <h2>1. O que você precisa</h2>
          <div className="field">
            <label htmlFor="categoryId">Categoria</label>
            <select id="categoryId" name="categoryId" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.enabled}>
                  {c.name}{c.enabled ? ` — referência ${formatBRL(c.suggested_price_cents)}` : ' — ainda não habilitada'}
                </option>
              ))}
            </select>
            <span className="hint">A referência é uma tabela demonstrativa da plataforma, não um preço de mercado. Você escolhe o valor.</span>
          </div>
          <fieldset>
            <legend>Especialidades (opcional)</legend>
            {categories.filter((c) => c.enabled).map((c) => {
              const ts = tags.filter((t) => t.category_id === c.id);
              return ts.length ? (
                <div key={c.id} style={{ marginBottom: 6 }}>
                  <small>{c.name}</small>
                  <div className="row">{ts.map((t) => <label key={t.id} className="check"><input type="checkbox" name="tagIds" value={t.id} />{t.name}</label>)}</div>
                </div>
              ) : null;
            })}
            <span className="hint">Valem apenas as especialidades da categoria escolhida.</span>
          </fieldset>
          <div className="field"><label htmlFor="title">Título</label><input id="title" name="title" required minLength={3} maxLength={120} placeholder="Ex.: Limpeza de cozinha" /></div>
          <div className="field"><label htmlFor="description">Descrição do serviço</label><textarea id="description" name="description" required minLength={10} placeholder="O que deve ser feito, tamanho do espaço, condições…" /></div>
          <div className="field"><label htmlFor="materials">Materiais, ferramentas e despesas <span className="hint">Quem leva o quê e o que está incluso no valor.</span></label><input id="materials" name="materials" placeholder="Ex.: produtos de limpeza por minha conta" /></div>
          {approvedOrgs.length > 0 && (
            <div className="field">
              <label htmlFor="organizationId">Contratar como</label>
              <select id="organizationId" name="organizationId" defaultValue="">
                <option value="">Pessoa física (eu)</option>
                {approvedOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
        </section>

        <section className="card">
          <h2>2. Onde</h2>
          <p className="muted">Os profissionais veem apenas bairro e cidade. O endereço completo só aparece para quem for contratado, depois da confirmação.</p>
          <div className="grid two">
            <div className="field"><label htmlFor="uf">UF</label><select id="uf" name="uf" required defaultValue="SP">{UFS.map((u) => <option key={u}>{u}</option>)}</select></div>
            <div className="field"><label htmlFor="city">Cidade</label><input id="city" name="city" required /></div>
            <div className="field"><label htmlFor="area">Bairro</label><input id="area" name="area" required /></div>
            <div className="field"><label htmlFor="street">Rua / avenida (privado)</label><input id="street" name="street" required /></div>
            <div className="field"><label htmlFor="number">Número (privado)</label><input id="number" name="number" /></div>
            <div className="field"><label htmlFor="complement">Complemento (privado)</label><input id="complement" name="complement" /></div>
          </div>
          <div className="field"><label htmlFor="reference">Ponto de referência (privado)</label><input id="reference" name="reference" /></div>
          <GeoFields />
        </section>

        <section className="card">
          <h2>3. Quando</h2>
          <fieldset>
            <legend>Tipo de pedido</legend>
            <label className="check"><input type="radio" name="kind" value="urgent" defaultChecked />Urgente — para agora. Vai para quem está disponível no momento e expira em 3 horas (renovável).</label>
            <label className="check"><input type="radio" name="kind" value="scheduled" />Agendado — com data e hora marcadas.</label>
          </fieldset>
          <div className="field">
            <label htmlFor="startsAtLocal">Data e hora (somente agendado) <span className="hint">No horário local da cidade do serviço.</span></label>
            <input id="startsAtLocal" name="startsAtLocal" type="datetime-local" />
          </div>
          <fieldset>
            <legend>Duração estimada</legend>
            <div className="grid two">
              <div><label htmlFor="durationHours">Horas</label><input id="durationHours" name="durationHours" type="number" min={0} max={300} defaultValue={2} required /></div>
              <div><label htmlFor="durationMinutes">Minutos</label><select id="durationMinutes" name="durationMinutes" defaultValue="0"><option>0</option><option>15</option><option>30</option><option>45</option></select></div>
            </div>
            <span className="hint">Bloqueia a agenda do profissional neste intervalo. Não há intervalo extra de deslocamento.</span>
          </fieldset>
        </section>

        <section className="card">
          <h2>4. Vagas e valor</h2>
          <div className="grid two">
            <div className="field"><label htmlFor="seats">Quantos profissionais <span className="hint">Cada um terá um contrato independente. Você pode fechar com menos.</span></label><input id="seats" name="seats" type="number" min={1} max={50} defaultValue={1} required /></div>
            <div className="field"><label htmlFor="price">Valor por profissional (R$)</label><input id="price" name="price" inputMode="decimal" required placeholder="120,00" /></div>
          </div>
          <fieldset>
            <legend>Modalidade de cobrança</legend>
            <label className="check"><input type="radio" name="billingUnit" value="fixed" defaultChecked />Preço fechado pelo serviço</label>
            <label className="check"><input type="radio" name="billingUnit" value="hour" />Por hora — o valor acima é a tarifa por hora; a duração estimada define o teto pago antecipadamente</label>
          </fieldset>
          <fieldset>
            <legend>Forma de pagamento</legend>
            <label className="check"><input type="radio" name="paymentKind" value="digital" defaultChecked />Digital (Pix, cartão ou crédito da carteira) — pago após aprovar o profissional e retido até a conclusão</label>
            <label className="check"><input type="radio" name="paymentKind" value="cash" />Dinheiro físico — pago diretamente ao profissional, fora da plataforma</label>
          </fieldset>
        </section>
        <Submit>Revisar pedido</Submit>
      </form>
    </>
  );
}
