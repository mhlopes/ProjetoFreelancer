import { formatBRL } from '@/lib/money';

export function Badge({ map, value }: { map: Record<string, [string, string]>; value: string }) {
  const [label, tone] = map[value] ?? [value, 'neutral'];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export const Money = ({ cents }: { cents: number }) => <span className="money">{formatBRL(cents)}</span>;

/** Caminho de retorno da ação (validado no servidor). */
export const Back = ({ to }: { to: string }) => <input type="hidden" name="_back" value={to} />;

export const Hidden = ({ name, value }: { name: string; value: string | number }) => <input type="hidden" name={name} value={value} />;

export function Stars({ average10, count }: { average10: number | null; count: number }) {
  if (!count || average10 == null) return <span className="muted">Sem avaliações publicadas ainda</span>;
  return <span><strong>{(average10 / 10).toFixed(1).replace('.', ',')}</strong> de 5 <span className="muted">({count} {count === 1 ? 'avaliação' : 'avaliações'})</span></span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
