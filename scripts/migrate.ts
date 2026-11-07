import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { migrations, migrationSQL } from '../src/server/migrations';
async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const connectionString =
    process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "Defina DATABASE_MIGRATION_URL ou DATABASE_URL. O modo local aplica o esquema automaticamente.",
    );
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query("BEGIN");
    await pool.query('SELECT pg_advisory_xact_lock(7182362)');
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied=await pool.query('SELECT version FROM schema_migrations');
    for(let index=0;index<migrations.length;index++) {
      if(!applied.rows.some(row=>row.version===index+1)) await pool.query(await migrationSQL(index));
    }
    await pool.query("COMMIT");
    console.log("Esquema PostgreSQL aplicado.");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    "Migração não concluída:",
    error instanceof Error ? error.name : "erro desconhecido",
  );
  process.exitCode = 1;
});
