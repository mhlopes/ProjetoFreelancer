import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="card">
      <h1>Página não encontrada</h1>
      <p>O conteúdo não existe ou você não tem acesso a ele.</p>
      <Link className="btn" href="/">Voltar ao início</Link>
    </section>
  );
}
