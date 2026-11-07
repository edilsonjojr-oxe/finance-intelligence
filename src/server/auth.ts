import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { transaction } from "./db";
import { isHostedDeployment } from "./deployment-config";
const scrypt = promisify(scryptCallback);
export const sessionCookie = "fi_session";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const result = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${result.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, expected] = encoded.split(":");
  const result = (await scrypt(password, salt, 64)) as Buffer;
  return (
    result.length === Buffer.from(expected, "hex").length &&
    timingSafeEqual(result, Buffer.from(expected, "hex"))
  );
}
export function authProvider(): "local" | "supabase" {
  const provider=process.env.AUTH_PROVIDER || "local";
  if(provider!=="local" && provider!=="supabase")throw new AppError("Provedor de autenticação inválido.",503);
  return provider;
}
export async function authStatus(token?: string) {
  if(authProvider()==="supabase")return (await import("./supabase-auth")).supabaseAuthStatus();
  return transaction(null, async (db) => {
    const users = await db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users",
    );
    const result = token
      ? await db.query<{ id: string; name: string; email: string }>(
          "SELECT u.id,u.name,u.email FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at > now()",
          [hash(token)],
        )
      : { rows: [] };
    return {
      provider: "local" as const,
      needsSetup: users.rows[0].count === "0",
      requiresSetupToken: !!process.env.SETUP_TOKEN || isHostedDeployment(),
      user: result.rows[0] || null,
    };
  });
}
export async function requireUser(token?: string) {
  const { user } = await authStatus(token);
  if (!user) throw new AppError("Entre na sua conta para continuar.", 401);
  return user;
}
export async function authenticate(
  mode: "setup" | "login",
  email: string,
  password: string,
  name = "",
  setupToken = '',
) {
  if(mode==='setup' && (process.env.SETUP_TOKEN || isHostedDeployment())) {
    if(!process.env.SETUP_TOKEN || !timingSafeEqual(Buffer.from(hash(setupToken)),Buffer.from(hash(process.env.SETUP_TOKEN))))throw new AppError('Código de ativação inválido.',403);
  }
  // O limite global persiste e impede contornar bloqueio trocando o e-mail.
  const allowed = await transaction(null, async (db) => {
    await db.query(
      "INSERT INTO login_attempts(key) VALUES('global') ON CONFLICT DO NOTHING",
    );
    await db.query(
      "UPDATE login_attempts SET attempts=0,window_start=now() WHERE key='global' AND window_start < now() - interval '15 minutes'",
    );
    const r = await db.query<{ attempts: number }>(
      "UPDATE login_attempts SET attempts=attempts+1 WHERE key='global' RETURNING attempts",
    );
    return r.rows[0].attempts <= 20;
  });
  if (!allowed)
    throw new AppError("Muitas tentativas. Aguarde 15 minutos.", 429);
  const encoded = mode === "setup" ? await passwordHash(password) : null;
  return transaction(null, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7182361)");
    if (mode === "setup") {
      const existing = await db.query("SELECT id FROM users LIMIT 1");
      if (existing.rows.length)
        throw new AppError("O perfil já foi criado. Use Entrar.", 409);
      await db.query(
        "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
        [randomUUID(), name, email, encoded],
      );
    }
    const result = await db.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM users WHERE email=$1",
      [email],
    );
    const user = result.rows[0];
    const valid = await verifyPassword(
      password,
      user?.password_hash ||
        "00000000000000000000000000000000:" + "00".repeat(64),
    );
    if (!user || !valid) throw new AppError("E-mail ou senha inválidos.", 401);
    const token = randomBytes(32).toString("hex");
    await db.query("DELETE FROM sessions WHERE expires_at < now()");
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [hash(token), user.id],
    );
    await db.query("UPDATE login_attempts SET attempts=0 WHERE key='global'");
    return token;
  });
}
export async function logout(token: string) {
  await transaction(null, (db) =>
    db.query("DELETE FROM sessions WHERE token_hash=$1", [hash(token)]),
  );
}
