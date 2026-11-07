// Copia o perfil da base local (PGlite) para o PostgreSQL remoto, preservando IDs e vínculos.
// Uso: npx tsx scripts/copy-to-postgres.ts <pasta .data de origem> [--owner=<email>] [--apply]
// Sem --apply apenas conta os registros. O destino precisa estar vazio e migrado; a conexão
// vem de .env.supabase (papel restrito). A origem é aberta somente para leitura lógica:
// pare o servidor que usa a pasta antes de executar (PGlite aceita um processo por vez).
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool, types } from 'pg';
import { backupTables, collectSnapshot, restoreSnapshot } from '../src/server/backup';
import { databaseTLS } from '../src/server/deployment-config';
import { migrations } from '../src/server/migrations';
import type { DB } from '../src/server/db';
types.setTypeParser(1082, (value) => value);

async function main() {
  const args = process.argv.slice(2);
  const source = args.find((a) => !a.startsWith('--'));
  const flag = args.includes('--apply') ? '--apply' : '';
  const ownerEmail = args.find((a) => a.startsWith('--owner='))?.slice(8);
  if (!source) throw new Error('Informe a pasta de origem, por exemplo .data/finance.');
  process.loadEnvFile('.env.supabase');
  if (!process.env.DATABASE_URL) throw new Error('.env.supabase precisa de DATABASE_URL.');
  const local = new PGlite(path.resolve(source));
  await local.waitReady;
  try {
    const owners = ownerEmail
      ? await local.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=lower($1)', [ownerEmail])
      : await local.query<{ id: string }>('SELECT id FROM users');
    if (owners.rows.length !== 1) throw new Error(`Esperado 1 perfil na origem, encontrado ${owners.rows.length}. Use --owner=<email>.`);
    const owner = owners.rows[0].id;
    const snapshot = await local.transaction((tx) => collectSnapshot(tx as unknown as DB, owner));
    const counts = Object.fromEntries(backupTables.map((t) => [t, snapshot.tables[t].length]));
    console.log('Origem:', JSON.stringify(counts));
    if (flag !== '--apply') return console.log('Simulação: nada foi gravado. Use --apply para copiar.');

    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.delete('sslmode');
    const pool = new Pool({ connectionString: url.toString(), ssl: databaseTLS(), max: 1 });
    const client = await pool.connect();
    try {
      const version = await client.query('SELECT max(version) AS v FROM schema_migrations');
      if (version.rows[0].v !== migrations.length) throw new Error('Destino com migrações pendentes.');
      await client.query('BEGIN');
      // As políticas RLS exigem o dono da transação definido.
      await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
      await restoreSnapshot(client as unknown as DB, snapshot);
      for (const t of backupTables) {
        const r = await client.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${t === 'users' ? 'id' : 'user_id'}=$1`, [owner]);
        if (r.rows[0].n !== counts[t]) throw new Error(`Contagem divergente em ${t}.`);
      }
      await client.query('COMMIT');
      console.log('Cópia concluída e conferida. A base local não foi alterada.');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  } finally {
    await local.close();
  }
}
main().catch((error) => {
  console.error('Cópia não concluída:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
});
