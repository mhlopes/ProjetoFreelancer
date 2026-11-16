import Link from 'next/link';
import { redirect } from 'next/navigation';
import { config } from '@/lib/config';
import { currentUser } from '@/lib/session';

export default async function Home() {
  const user = await currentUser();
  if (user) redirect(user.active_mode === 'worker' ? '/trabalhar' : '/contratar');
  return (
    <>
      <section className="card">
        <h1>{config.appName}</h1>
        <p>Contrate pessoas para pequenos serviços presenciais — limpeza, reparos, jardinagem, mudança, eventos — ou ofereça o seu trabalho. Vocês negociam pelo chat, combinam o valor e o pagamento digital fica retido até a conclusão.</p>
        <div className="row">
          <Link className="btn" href="/cadastro">Criar conta</Link>
          <Link className="btn ghost" href="/entrar">Já tenho conta</Link>
        </div>
      </section>
      <div className="grid three">
        <section className="card"><h2>1. Publique ou receba chamados</h2><p>Pedidos urgentes vão para quem está disponível agora; agendados respeitam a agenda de cada profissional.</p></section>
        <section className="card"><h2>2. Negocie e aprove</h2><p>Propostas e contrapropostas ficam registradas. Só há contratação quando o contratante aprova o profissional.</p></section>
        <section className="card"><h2>3. Conclua com segurança</h2><p>Após a conclusão registrada, o contratante confirma ou contesta em até 24 horas. As duas partes se avaliam.</p></section>
      </div>
    </>
  );
}
