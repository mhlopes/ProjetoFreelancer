'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card" role="alert">
      <h1>Algo deu errado</h1>
      <p>Não foi possível carregar esta página. Nenhuma ação foi concluída pela metade: tente de novo.</p>
      <button className="btn" onClick={() => reset()}>Tentar novamente</button>
    </section>
  );
}
