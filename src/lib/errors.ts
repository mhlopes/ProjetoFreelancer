/** Erro de aplicação com código estável e status HTTP (docs/07-api.md). */
export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const invalid = (message: string, fieldErrors?: Record<string, string>) =>
  new AppError(400, 'invalid', message, fieldErrors);
export const unauthenticated = () => new AppError(401, 'unauthenticated', 'Entre na sua conta para continuar.');
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Não encontrado.') => new AppError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const rule = (code: string, message: string) => new AppError(422, code, message);
export const tooMany = (message = 'Muitas tentativas. Aguarde um pouco e tente de novo.') =>
  new AppError(429, 'rate_limited', message);

/** Converte violações de restrição do banco em conflitos de domínio. */
export function mapDbError(e: unknown): unknown {
  if (e instanceof AppError) return e;
  const err = e as { code?: string; constraint?: string };
  if (err?.code === '23P01') return conflict('schedule_conflict', 'O profissional já tem um compromisso neste horário.');
  if (err?.code === '23505') return conflict('duplicate', 'Esta operação já foi registrada ou conflita com outra existente.');
  if (err?.code === '23514' && String(err.constraint).includes('balance'))
    return rule('insufficient_funds', 'Saldo insuficiente.');
  return e;
}
