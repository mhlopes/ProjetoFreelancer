import Link from 'next/link';
import { redirect } from 'next/navigation';
import { config } from '@/lib/config';
import { currentUser } from '@/lib/session';
import { Submit } from '@/components/client';
import { loginAction } from '../actions';

export default async function Entrar() {
  if (await currentUser()) redirect('/');
  return (
    <section className="card" style={{ maxWidth: 440, margin: '0 auto' }}>
      <h1>Entrar</h1>
      <form action={loginAction}>
        <div className="field"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
        <div className="field"><label htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
        <Submit>Entrar</Submit>
      </form>
      <p style={{ marginTop: 12 }}>Ainda não tem conta? <Link href="/cadastro">Criar conta</Link></p>
      {config.env === 'development' && (
        <div className="note info">
          <p><strong>Contas fictícias de demonstração</strong> (senha <code>demo1234</code>):</p>
          <p>carla@demo.invalid (contratante) · joao@demo.invalid e maria@demo.invalid (trabalhadores) · suporte@demo.invalid (suporte)</p>
        </div>
      )}
    </section>
  );
}
