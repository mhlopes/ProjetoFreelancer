import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import './globals.css';
import { config, isMock } from '@/lib/config';
import { q1 } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { Flash } from '@/components/client';
import { setModeAction } from './actions';

export const metadata: Metadata = { title: config.appName, description: 'Serviços presenciais com negociação, agenda e pagamento organizado.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

const CLIENT_NAV = [['/contratar', 'Meus pedidos'], ['/contratos', 'Contratos'], ['/agenda', 'Agenda'], ['/mensagens', 'Mensagens'], ['/carteira', 'Carteira'], ['/perfil', 'Perfil']];
const WORKER_NAV = [['/trabalhar', 'Chamados'], ['/contratos', 'Trabalhos'], ['/agenda', 'Agenda'], ['/mensagens', 'Mensagens'], ['/carteira', 'Ganhos'], ['/trabalhar/perfil', 'Perfil profissional'], ['/perfil', 'Conta']];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const unread = user ? (await q1<{ c: number }>('SELECT count(*)::int AS c FROM notifications WHERE user_id=$1 AND read_at IS NULL', [user.id]))!.c : 0;
  const nav = user?.active_mode === 'worker' ? WORKER_NAV : CLIENT_NAV;
  return (
    <html lang="pt-BR">
      <body>
        <a className="skip" href="#conteudo">Pular para o conteúdo</a>
        {isMock() && (
          <div className="mockbar" role="note">
            Ambiente de demonstração — pagamentos, saques, SMS e verificação de identidade são <strong>SIMULADOS</strong>. Nenhum dinheiro real é movimentado.
          </div>
        )}
        <header className="top">
          <div className="top-in">
            <Link href="/" className="brand">{config.appName}</Link>
            {user ? (
              <>
                <form action={setModeAction} className="modes" aria-label="Área da conta">
                  <input type="hidden" name="_back" value="/" />
                  <button name="mode" value="client" aria-pressed={user.active_mode === 'client'}>Contratar</button>
                  <button name="mode" value="worker" aria-pressed={user.active_mode === 'worker'}>Trabalhar</button>
                </form>
                <Link href="/notificacoes" aria-label={`Notificações${unread ? `, ${unread} não lidas` : ''}`}>
                  Avisos{unread > 0 && <span className="pill">{unread}</span>}
                </Link>
              </>
            ) : (
              <Link href="/entrar" className="btn small ghost">Entrar</Link>
            )}
          </div>
          {user && (
            <nav className="nav" aria-label="Principal">
              {nav.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
              {user.is_support && <Link href="/admin">Suporte</Link>}
            </nav>
          )}
        </header>
        <main id="conteudo">
          <Suspense fallback={null}><Flash /></Suspense>
          {children}
        </main>
      </body>
    </html>
  );
}
