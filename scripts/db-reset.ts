/** Apaga o banco local embarcado. Pare o servidor antes. Na próxima subida, migrations e seed rodam de novo. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.APP_ENV === 'production') throw new Error('db:reset proibido em produção');
const dir = path.resolve(process.env.PGLITE_DIR || path.join(os.homedir(), '.plataforma-servicos', 'pgdata'));
if (!dir.includes('plataforma-servicos') && !dir.includes('pgdata')) throw new Error(`Recusando apagar diretório inesperado: ${dir}`);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Banco local removido: ${dir}`);
