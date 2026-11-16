import type { NextConfig } from 'next';

const config: NextConfig = {
  // PGlite carrega WASM e arquivos de dados próprios; não deve ser empacotado.
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
};

export default config;
