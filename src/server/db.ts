import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Pool, types } from "pg";
import { migrations, migrationSQL } from './migrations';
import { assertPersistentDatabase, databaseTLS, isHostedDeployment } from './deployment-config';
types.setTypeParser(1082, (value) => value);
export interface DB {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
type Local = { mode: "local"; client: PGlite };
type Remote = { mode: "postgres"; client: Pool };
const globalDB = globalThis as unknown as {
  financeDB?: Promise<Local | Remote>;
};
async function initialize(): Promise<Local | Remote> {
  assertPersistentDatabase();
  if (process.env.DATABASE_URL) {
    // Sem sslmode na URL: ele sobrescreveria a configuração TLS abaixo.
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.delete('sslmode');
    const pool = new Pool({
      connectionString: url.toString(),
      ssl: databaseTLS(),
      // Funções serverless abrem poucas conexões; o pooler do provedor multiplexa.
      max: isHostedDeployment() ? 2 : 5,
    });
    if(isHostedDeployment()) {
      const role=await pool.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user");
      if(!role.rows[0]||Object.values(role.rows[0]).some(Boolean)) {await pool.end();throw new Error('Use um papel de aplicação restrito.');}
    }
    // Migrações são executadas separadamente com uma credencial de administração.
    const version=await pool.query('SELECT max(version) AS version FROM schema_migrations');
    if(version.rows[0]?.version!==migrations.length) {await pool.end();throw new Error('Migrações pendentes. Execute db:migrate.');}
    return { mode: "postgres", client: pool };
  }
  const dataDir = path.resolve(
    /* turbopackIgnore: true */ process.env.FINANCE_DATA_DIR || ".data/finance",
  );
  await mkdir(path.dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  await client.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied=await client.query<{version:number}>('SELECT version FROM schema_migrations');
  for(let index=0;index<migrations.length;index++) {
    if(!applied.rows.some(row=>row.version===index+1)) {
      const sql=await migrationSQL(index);
      await client.transaction(async tx=>{await tx.exec(sql);});
    }
  }
  return { mode: "local", client };
}
export async function database() {
  return (globalDB.financeDB ??= initialize().catch((error) => {
    delete globalDB.financeDB;
    throw error;
  }));
}
export async function transaction<T>(
  userId: string | null,
  callback: (db: DB) => Promise<T>,
  snapshot = false,
): Promise<T> {
  const db = await database();
  if (db.mode === "local")
    return db.client.transaction(async (tx) => {
      if (userId)
        await tx.query("SELECT set_config('app.user_id',$1,true)", [userId]);
      return callback(tx as DB);
    });
  const client = await db.client.connect();
  try {
    await client.query(snapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : "BEGIN");
    if (userId)
      await client.query("SELECT set_config('app.user_id',$1,true)", [userId]);
    const result = await callback(client as DB);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
