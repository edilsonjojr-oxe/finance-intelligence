import { randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { AppError,hash,passwordHash,verifyPassword } from './auth';
import { transaction,type DB } from './db';

export function validateSetupCode(value:string) {
  const expected=process.env.SETUP_TOKEN;
  if(!expected||expected.length<32||!timingSafeEqual(Buffer.from(hash(value)),Buffer.from(hash(expected))))throw new AppError('Código de ativação inválido.',403);
}
export async function authAttempt() {
  const allowed=await transaction(null,async db=>{
    await db.query("INSERT INTO login_attempts(key) VALUES('supabase') ON CONFLICT DO NOTHING");
    await db.query("UPDATE login_attempts SET attempts=0,window_start=now() WHERE key='supabase' AND window_start<now()-interval '15 minutes'");
    const r=await db.query<{attempts:number}>("UPDATE login_attempts SET attempts=attempts+1 WHERE key='supabase' RETURNING attempts");
    return r.rows[0].attempts<=20;
  });
  if(!allowed)throw new AppError('Muitas tentativas. Aguarde 15 minutos.',429);
}
export async function enrollmentOwner(db:DB,email:string,localPassword:string,setupCode:string) {
  const users=(await db.query<{id:string;email:string;password_hash:string;supabase_subject:string|null}>('SELECT id,email,password_hash,supabase_subject FROM users')).rows;
  if(!users.length){validateSetupCode(setupCode);return null;}
  const owner=users.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!owner||owner.supabase_subject||!localPassword||!await verifyPassword(localPassword,owner.password_hash))throw new AppError('Para vincular o perfil existente, informe o mesmo e-mail e a senha anterior da instalação.',403);
  return owner.id;
}
export async function linkVerifiedIdentity(identity:{id:string;email:string;email_confirmed_at?:string|null},issuer:string,localPassword:string,setupCode:string,name:string) {
  if(!identity.email_confirmed_at)throw new AppError('Confirme seu e-mail no Supabase antes de entrar.',403);
  return transaction(null,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(7182361)');
    const linked=await db.query<{id:string;name:string;email:string}>('SELECT id,name,email FROM users WHERE supabase_subject=$1 AND supabase_issuer=$2',[identity.id,issuer]);
    if(linked.rows[0])return linked.rows[0];
    const existing=await enrollmentOwner(db,identity.email,localPassword,setupCode);
    const id=existing||randomUUID();
    if(existing)await db.query('UPDATE users SET supabase_subject=$1,supabase_issuer=$2 WHERE id=$3',[identity.id,issuer,id]);
    else await db.query('INSERT INTO users(id,name,email,password_hash,supabase_subject,supabase_issuer) VALUES($1,$2,$3,$4,$5,$6)',[id,name.trim()||'Meu perfil',identity.email,await passwordHash(randomBytes(48).toString('hex')),identity.id,issuer]);
    await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);
    await db.query("INSERT INTO audit_events(id,user_id,action,entity_id,details) VALUES($1,$2,'auth.supabase.link',$2,'{}')",[randomUUID(),id]);
    return (await db.query<{id:string;name:string;email:string}>('SELECT id,name,email FROM users WHERE id=$1',[id])).rows[0];
  });
}
