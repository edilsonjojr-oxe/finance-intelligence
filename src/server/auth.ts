import {
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { transaction, type DB } from "./db";
import { isHostedDeployment } from "./deployment-config";
const scrypt = promisify(scryptCallback);
export const sessionCookie = "fi_session";
export const SESSION_IDLE_DAYS = 7;
export const SESSION_MAX_DAYS = 30;
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
export async function authStatus(token?: string) {
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
    // Sessão deslizante: cada uso estende até 7 dias sem atividade, sem passar de 30 dias desde
    // o login. Grava no máximo uma vez por dia (só quando faltam menos de 6 dias).
    if (result.rows[0])
      await db.query(
        `UPDATE sessions SET expires_at=LEAST(now()+interval '${SESSION_IDLE_DAYS} days', created_at+interval '${SESSION_MAX_DAYS} days')
         WHERE token_hash=$1 AND expires_at < now()+interval '${SESSION_IDLE_DAYS - 1} days'`,
        [hash(token!)],
      );
    return {
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

// Códigos de convite: 12 caracteres sem ambiguidade (sem 0/O/1/I), exibidos em grupos de 4.
const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const normalizeInvite = (code: string) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export async function createInvite(userId: string) {
  const code = Array.from({ length: 12 }, () => inviteAlphabet[randomInt(inviteAlphabet.length)]).join("");
  return transaction(userId, async (db) => {
    const recent = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM invites WHERE created_by=$1 AND created_at > now() - interval '1 day'",
      [userId],
    );
    if (recent.rows[0].n >= 10)
      throw new AppError("Limite de 10 convites por dia atingido.", 429);
    const expires = await db.query<{ expires_at: string }>(
      "INSERT INTO invites(code_hash,created_by,expires_at) VALUES($1,$2,now()+interval '7 days') RETURNING expires_at::text",
      [hash(normalizeInvite(code)), userId],
    );
    await db.query(
      "INSERT INTO audit_events(id,user_id,action,entity_id,details) VALUES($1,$2,'invite.created',NULL,'{}')",
      [randomUUID(), userId],
    );
    return { code: code.match(/.{4}/g)!.join("-"), expires_at: expires.rows[0].expires_at };
  });
}

/** Limite por e-mail (impede força bruta numa conta) e global (impede varrer e-mails). */
async function rateLimit(email: string) {
  const allowed = await transaction(null, async (db) => {
    const check = async (key: string, max: number) => {
      await db.query("INSERT INTO login_attempts(key) VALUES($1) ON CONFLICT DO NOTHING", [key]);
      await db.query(
        "UPDATE login_attempts SET attempts=0,window_start=now() WHERE key=$1 AND window_start < now() - interval '15 minutes'",
        [key],
      );
      const r = await db.query<{ attempts: number }>(
        "UPDATE login_attempts SET attempts=attempts+1 WHERE key=$1 RETURNING attempts",
        [key],
      );
      return r.rows[0].attempts <= max;
    };
    const perEmail = await check(`email:${hash(email)}`, 10);
    const global = await check("global", 100);
    return perEmail && global;
  });
  if (!allowed)
    throw new AppError("Muitas tentativas. Aguarde 15 minutos.", 429);
}
function checkSetupToken(setupToken: string) {
  if (process.env.SETUP_TOKEN || isHostedDeployment()) {
    if (
      !process.env.SETUP_TOKEN ||
      !timingSafeEqual(Buffer.from(hash(setupToken)), Buffer.from(hash(process.env.SETUP_TOKEN)))
    )
      throw new AppError("Código de ativação inválido.", 403);
  }
}
async function useInvite(db: DB, code: string) {
  const invite = await db.query<{ created_by: string }>(
    "SELECT created_by FROM invites WHERE code_hash=$1 AND used_by IS NULL AND expires_at > now() FOR UPDATE",
    [hash(normalizeInvite(code))],
  );
  if (!invite.rows[0])
    throw new AppError("Convite inválido, expirado ou já utilizado.", 403);
  return invite.rows[0].created_by;
}

export async function authenticate(
  mode: "setup" | "login" | "register",
  email: string,
  password: string,
  name = "",
  code = "",
) {
  email = email.trim().toLowerCase();
  if (mode === "setup") checkSetupToken(code);
  await rateLimit(email);
  const encoded = mode === "login" ? null : await passwordHash(password);
  return transaction(null, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7182361)");
    if (mode === "setup" || mode === "register") {
      const id = randomUUID();
      if (mode === "setup") {
        const existing = await db.query("SELECT id FROM users LIMIT 1");
        if (existing.rows.length)
          throw new AppError("O primeiro perfil já foi criado. Use Entrar ou um convite.", 409);
      }
      const inviter = mode === "register" ? await useInvite(db, code) : null;
      const taken = await db.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email]);
      if (taken.rows.length)
        throw new AppError("Este e-mail já tem acesso. Use Entrar.", 409);
      await db.query(
        "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
        [id, name, email, encoded],
      );
      if (inviter) {
        await db.query(
          "UPDATE invites SET used_by=$1,used_at=now() WHERE code_hash=$2",
          [id, hash(normalizeInvite(code))],
        );
        // A auditoria tem RLS por dono: identifica o novo usuário nesta transação.
        await db.query("SELECT set_config('app.user_id',$1,true)", [id]);
        await db.query(
          "INSERT INTO audit_events(id,user_id,action,entity_id,details) VALUES($1,$2,'invite.accepted',NULL,'{}')",
          [randomUUID(), id],
        );
      }
    }
    const result = await db.query<{ id: string; password_hash: string }>(
      "SELECT id,password_hash FROM users WHERE lower(email)=lower($1)",
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
      `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '${SESSION_IDLE_DAYS} days')`,
      [hash(token), user.id],
    );
    await db.query("UPDATE login_attempts SET attempts=0 WHERE key=$1", [`email:${hash(email)}`]);
    return token;
  });
}
export async function logout(token: string) {
  await transaction(null, (db) =>
    db.query("DELETE FROM sessions WHERE token_hash=$1", [hash(token)]),
  );
}
/** Encerra todas as sessões do usuário (todos os aparelhos), inclusive a atual. */
export async function logoutEverywhere(userId: string) {
  return transaction(null, async (db) => {
    const r = await db.query("DELETE FROM sessions WHERE user_id=$1 RETURNING token_hash", [userId]);
    await db.query("SELECT set_config('app.user_id',$1,true)", [userId]);
    await db.query(
      "INSERT INTO audit_events(id,user_id,action,entity_id,details) VALUES($1,$2,'auth.logout_all',NULL,$3)",
      [randomUUID(), userId, JSON.stringify({ sessions: r.rows.length })],
    );
    return r.rows.length;
  });
}
