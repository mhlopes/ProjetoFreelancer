/** Inicialização do servidor: valida configuração, aplica migrations, semeia dados fictícios (dev) e liga os jobs. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertBootConfig, config } = await import('@/lib/config');
  assertBootConfig(); // produção falha aqui com mock ou parâmetros comerciais ausentes
  const { root } = await import('@/lib/db');
  await root();
  if (config.env === 'development') {
    const { seedDemoIfEmpty } = await import('../db/seeds/demo');
    await seedDemoIfEmpty();
  }
  const { startJobLoop } = await import('@/modules/jobs');
  startJobLoop();
  console.log(`[boot] ${config.appName} — ambiente ${config.env}; pagamentos: ${config.paymentProvider}; identidade: ${config.identityProvider}`);
}
