// Desenvolvimento contra o PostgreSQL do Supabase, sem afetar o servidor pessoal (PGlite).
// Lê .env.supabase (não versionado) e inicia `next dev` na porta 3003.
import { spawn } from 'node:child_process';
process.loadEnvFile('.env.supabase');
if (!process.env.DATABASE_URL) throw new Error('.env.supabase precisa de DATABASE_URL.');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', process.env.PORT || '3003'], {
  stdio: 'inherit',
  env: { ...process.env, APP_ORIGIN: '', SETUP_TOKEN: '', CLOUD_DEPLOYMENT: '' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
