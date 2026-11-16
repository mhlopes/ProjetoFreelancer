/** Configuração por ambiente. Produção falha na inicialização com mocks ou parâmetros comerciais ausentes. */
const env = process.env;
const bool = (v: string | undefined) => v === 'true' || v === '1';

const DEV_SECRET = 'dev-only-secret-nao-usar-em-producao';
const DEV_WEBHOOK_SECRET = 'dev-only-webhook-secret';

export const config = {
  env: (env.APP_ENV ?? 'development') as 'development' | 'test' | 'staging' | 'production',
  appName: env.APP_NAME ?? 'Plataforma de Serviços',
  authSecret: env.AUTH_SECRET && env.AUTH_SECRET !== 'replace_with_local_random_secret' ? env.AUTH_SECRET : DEV_SECRET,
  paymentProvider: env.PAYMENT_PROVIDER ?? 'mock',
  webhookSecret: env.PAYMENT_WEBHOOK_SECRET || DEV_WEBHOOK_SECRET,
  identityProvider: env.IDENTITY_PROVIDER ?? 'mock',
  /** Comissão não definida (O01): ausente em dev/teste equivale a 0 sintético. */
  platformFeeBps: env.PLATFORM_FEE_BPS != null && env.PLATFORM_FEE_BPS !== '' ? Number(env.PLATFORM_FEE_BPS) : null,
  policyStatus: env.POLICY_STATUS ?? 'draft',
  features: {
    transport: bool(env.FEATURE_TRANSPORT),
    security: bool(env.FEATURE_SECURITY_SERVICES),
    delivery: bool(env.FEATURE_DELIVERY),
    premium: false as const, // Premium fora da primeira versão (D13).
  } as Record<string, boolean>,
  onlineWindowMinutes: Number(env.ONLINE_WINDOW_MINUTES ?? 60),
};

export const isMock = () => config.paymentProvider === 'mock' || config.identityProvider === 'mock';

export function feeBps(): number {
  if (config.platformFeeBps == null) {
    if (config.env === 'production') throw new Error('PLATFORM_FEE_BPS obrigatório em produção');
    return 0; // sintético
  }
  if (!Number.isInteger(config.platformFeeBps) || config.platformFeeBps < 0 || config.platformFeeBps > 10_000)
    throw new Error('PLATFORM_FEE_BPS inválido');
  return config.platformFeeBps;
}

export function assertBootConfig() {
  if (config.env !== 'production') return;
  const problems: string[] = [];
  if (config.paymentProvider === 'mock') problems.push('PAYMENT_PROVIDER=mock');
  if (config.identityProvider === 'mock') problems.push('IDENTITY_PROVIDER=mock');
  if (config.platformFeeBps == null) problems.push('PLATFORM_FEE_BPS indefinido');
  if (config.authSecret === DEV_SECRET) problems.push('AUTH_SECRET padrão');
  if (config.webhookSecret === DEV_WEBHOOK_SECRET) problems.push('PAYMENT_WEBHOOK_SECRET padrão');
  if (config.policyStatus !== 'approved') problems.push('POLICY_STATUS não aprovado');
  problems.push('banco embarcado (PGlite) e adaptadores reais ausentes: este protótipo não opera em produção');
  throw new Error(`Configuração proibida em produção: ${problems.join('; ')}`);
}
