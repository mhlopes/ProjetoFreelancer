import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { formatDateTime, timezoneForUf, UFS } from '@/lib/time';
import { getWorkerProfile, listAvailabilityBlocks, listCategories, listTags } from '@/modules/profiles';
import { GeoFields, Submit } from '@/components/client';
import { Back, Hidden } from '@/components/ui';
import { addAvailabilityBlockAction, removeAvailabilityBlockAction, saveWorkerProfileAction } from '../../actions';

export default async function PerfilProfissional() {
  const { actor } = await requireActor();
  const [p, categories, tags, blocks] = await Promise.all([getWorkerProfile(actor.id), listCategories(), listTags(), listAvailabilityBlocks(actor)]);
  const tz = p ? timezoneForUf(p.uf)! : 'America/Sao_Paulo';
  return (
    <>
      <h1>Perfil profissional</h1>
      <p><Link href={`/u/${actor.id}`}>Ver como os contratantes me veem</Link></p>
      <form action={saveWorkerProfileAction} className="card">
        <Back to="/trabalhar/perfil" />
        <h2>Serviços que você faz</h2>
        <fieldset>
          <legend>Categorias</legend>
          {categories.map((c) => (
            <div key={c.id} style={{ marginBottom: 8 }}>
              <label className="check">
                <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={p?.categoryIds.includes(c.id)} disabled={!c.enabled} />
                <span><strong>{c.name}</strong>{!c.enabled && <span className="muted"> — ainda não habilitada{c.requires_credential ? ' (exigirá credencial verificada)' : ''}</span>}</span>
              </label>
              <div className="row" style={{ paddingLeft: 28 }}>
                {tags.filter((t) => t.category_id === c.id).map((t) => (
                  <label key={t.id} className="check"><input type="checkbox" name="tagIds" value={t.id} defaultChecked={p?.tagIds.includes(t.id)} disabled={!c.enabled} />{t.name}</label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        <div className="field"><label htmlFor="bio">Sobre você</label><textarea id="bio" name="bio" maxLength={2000} defaultValue={p?.bio} placeholder="Apresente-se em poucas linhas" /></div>
        <div className="field"><label htmlFor="experience">Experiências</label><textarea id="experience" name="experience" maxLength={4000} defaultValue={p?.experience} placeholder="Onde já trabalhou, há quanto tempo, cursos…" /></div>
        <h2>Onde você atende</h2>
        <div className="grid three">
          <div className="field"><label htmlFor="uf">UF</label><select id="uf" name="uf" required defaultValue={p?.uf ?? 'SP'}>{UFS.map((u) => <option key={u}>{u}</option>)}</select></div>
          <div className="field"><label htmlFor="city">Cidade</label><input id="city" name="city" required defaultValue={p?.city} /></div>
          <div className="field"><label htmlFor="radiusKm">Raio de atendimento (km)</label><input id="radiusKm" name="radiusKm" type="number" min={1} max={200} required defaultValue={p?.radius_km ?? 10} /></div>
        </div>
        <GeoFields lat={p?.lat} lng={p?.lng} />
        <Submit>Salvar perfil</Submit>
      </form>

      <section className="card">
        <h2>Períodos indisponíveis</h2>
        <p className="muted">Sua agenda fica livre por padrão; contratos confirmados bloqueiam o horário automaticamente. Registre aqui quando não puder atender chamados agendados.</p>
        {!p ? <p className="muted">Salve o perfil primeiro.</p> : (
          <>
            {blocks.length > 0 && (
              <ul className="list" style={{ marginBottom: 12 }}>
                {blocks.map((b) => (
                  <li key={b.id} className="row between">
                    <span>{formatDateTime(b.starts_at, tz)} até {formatDateTime(b.ends_at, tz)} {b.note && <small>— {b.note}</small>}</span>
                    <form action={removeAvailabilityBlockAction}><Back to="/trabalhar/perfil" /><Hidden name="id" value={b.id} /><Submit className="btn ghost small">Remover</Submit></form>
                  </li>
                ))}
              </ul>
            )}
            <form action={addAvailabilityBlockAction}>
              <Back to="/trabalhar/perfil" />
              <div className="grid three">
                <div className="field"><label htmlFor="startLocal">Início</label><input id="startLocal" name="startLocal" type="datetime-local" required /></div>
                <div className="field"><label htmlFor="endLocal">Fim</label><input id="endLocal" name="endLocal" type="datetime-local" required /></div>
                <div className="field"><label htmlFor="note">Observação</label><input id="note" name="note" maxLength={200} /></div>
              </div>
              <Submit className="btn ghost">Adicionar período</Submit>
            </form>
          </>
        )}
      </section>
    </>
  );
}
