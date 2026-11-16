import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { Submit } from '@/components/client';
import { registerAction } from '../actions';

export default async function Cadastro() {
  if (await currentUser()) redirect('/');
  return (
    <section className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1>Criar conta</h1>
      <p className="muted">A mesma conta serve para contratar e para trabalhar. Somente maiores de 18 anos.</p>
      <form action={registerAction}>
        <div className="field"><label htmlFor="name">Nome completo</label><input id="name" name="name" autoComplete="name" required minLength={2} /></div>
        <div className="field"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
        <div className="field"><label htmlFor="phone">Telefone com DDD</label><input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="(11) 90000-0000" /></div>
        <div className="field">
          <label htmlFor="cpf">CPF <span className="hint">Guardado cifrado; nunca aparece em perfis ou listagens.</span></label>
          <input id="cpf" name="cpf" inputMode="numeric" required placeholder="000.000.000-00" />
        </div>
        <div className="field"><label htmlFor="birthDate">Data de nascimento</label><input id="birthDate" name="birthDate" type="date" required /></div>
        <div className="field"><label htmlFor="password">Senha <span className="hint">Mínimo de 8 caracteres.</span></label><input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} /></div>
        <Submit>Criar conta</Submit>
      </form>
      <p style={{ marginTop: 12 }}>Já tem conta? <Link href="/entrar">Entrar</Link></p>
    </section>
  );
}
