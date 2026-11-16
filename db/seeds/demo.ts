import { q, q1 } from '@/lib/db';
import { addMinutes, now } from '@/lib/clock';
import { cpfCheckDigits } from '@/lib/crypto';
import { register } from '@/modules/identity';

/**
 * Dados FICTÍCIOS e reproduzíveis para desenvolvimento. Nenhuma pessoa, documento ou endereço real:
 * e-mails no domínio reservado .invalid e CPFs sintéticos gerados a partir de uma base sequencial.
 */
const fakeCpf = (n: number) => {
  const base = String(900_000_000 + n);
  return base + cpfCheckDigits(base);
};

const PEOPLE = [
  { key: 'carla', name: 'Carla Contratante (fictícia)', support: false, worker: null },
  { key: 'joao', name: 'João Diarista (fictício)', support: false, worker: { bio: 'Faço limpeza residencial e pós-obra há 6 anos.', cats: ['limpeza'], tags: ['residencial', 'pos-obra'], dLat: 0.012, dLng: 0.004 } },
  { key: 'maria', name: 'Maria Reparos (fictícia)', support: false, worker: { bio: 'Limpeza, pequenos reparos e montagem de móveis.', cats: ['limpeza', 'pequenos-reparos'], tags: ['residencial', 'montagem-moveis'], dLat: -0.02, dLng: 0.015 } },
  { key: 'suporte', name: 'Equipe de Suporte (fictícia)', support: true, worker: null },
] as const;

export async function seedDemoIfEmpty() {
  const n = await q1<{ c: number }>('SELECT count(*)::int AS c FROM users');
  if (n!.c > 0) return false;
  let i = 0;
  for (const p of PEOPLE) {
    i++;
    const u = await register({
      name: p.name, email: `${p.key}@demo.invalid`, phone: `1190000000${i}`, cpf: fakeCpf(i), birthDate: '1990-05-10', password: 'demo1234',
    });
    // contas de demonstração já nascem com telefone e identidade "validados" pelo verificador simulado
    await q(`UPDATE users SET phone_verified_at=$2, identity_status='verified', is_support=$3, active_mode=$4 WHERE id=$1`, [
      u.id, now(), p.support, p.worker ? 'worker' : 'client',
    ]);
    if (p.worker) {
      await q(
        `INSERT INTO worker_profiles (user_id, bio, experience, radius_km, city, uf, lat, lng, online_until)
         VALUES ($1,$2,'',15,'São Paulo','SP',$3,$4,$5)`,
        [u.id, p.worker.bio, -23.5505 + p.worker.dLat, -46.6333 + p.worker.dLng, addMinutes(now(), 8 * 60)],
      );
      for (const slug of p.worker.cats)
        await q('INSERT INTO worker_skills (user_id, category_id) SELECT $1, id FROM categories WHERE slug=$2', [u.id, slug]);
      for (const slug of p.worker.tags)
        await q(
          `INSERT INTO worker_tags (user_id, tag_id) SELECT $1, t.id FROM tags t JOIN worker_skills s ON s.category_id = t.category_id AND s.user_id = $1 WHERE t.slug=$2`,
          [u.id, slug],
        );
    }
  }
  console.log('[seed] dados fictícios criados: carla/joao/maria/suporte @demo.invalid (senha demo1234)');
  return true;
}
