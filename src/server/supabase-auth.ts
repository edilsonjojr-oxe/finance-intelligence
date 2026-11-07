import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError } from './auth';
import { transaction } from './db';
import { supabaseServerClient,supabaseConfiguration } from './supabase-client';
import { authAttempt,enrollmentOwner,linkVerifiedIdentity } from './supabase-identity';

export async function supabaseAuthStatus() {
  const client=await supabaseServerClient();
  const {data:{user},error}=await client.auth.getUser();
  const issuer=supabaseConfiguration().url;
  return transaction(null,async db=>{
    const count=await db.query<{count:string}>('SELECT count(*)::text AS count FROM users');
    const mapped=!error&&user?.email_confirmed_at?(await db.query<{id:string;name:string;email:string}>('SELECT id,name,email FROM users WHERE supabase_subject=$1 AND supabase_issuer=$2',[user.id,issuer])).rows[0]:null;
    return {provider:'supabase' as const,needsSetup:count.rows[0].count==='0',requiresSetupToken:count.rows[0].count==='0',user:mapped||null};
  });
}
const credentials=z.object({action:z.enum(['login','setup','register']),email:z.string().trim().toLowerCase().email().max(254),password:z.string().min(12).max(128),name:z.string().trim().max(100).default(''),setup_token:z.string().max(200).default(''),local_password:z.string().max(128).default('')}).strict();
export async function supabaseAuthAction(body:unknown) {
  const client=await supabaseServerClient();
  if(z.object({action:z.literal('logout')}).strict().safeParse(body).success){
    const {error}=await client.auth.signOut({scope:'local'});
    if(error)throw new AppError('Não foi possível revogar a sessão. Tente novamente.',503);
    return NextResponse.json({ok:true});
  }
  const v=credentials.parse(body);await authAttempt();
  if(v.action==='setup'||v.action==='register'){
    await transaction(null,db=>enrollmentOwner(db,v.email,v.local_password,v.setup_token));
    // Sem callback arbitrário, magic link ou redirect fornecido pelo usuário.
    const {error}=await client.auth.signUp({email:v.email,password:v.password});
    if(error)throw new AppError('Não foi possível criar o acesso. Confira os dados e tente novamente.',400);
    await client.auth.signOut({scope:'local'});
    return NextResponse.json({ok:true,message:'Acesso solicitado. Confirme o e-mail enviado pelo Supabase e depois entre. No primeiro vínculo, informe também a senha anterior da instalação ou o código de ativação.'});
  }
  const {data,error}=await client.auth.signInWithPassword({email:v.email,password:v.password});
  if(error||!data.user?.email)throw new AppError('E-mail/senha inválidos ou e-mail ainda não confirmado.',401);
  try{
    // Não confia apenas no objeto carregado de cookies nem em metadados editáveis.
    const verified=await client.auth.getUser();
    if(verified.error||!verified.data.user?.email)throw new AppError('Não foi possível verificar a sessão.',401);
    await linkVerifiedIdentity({id:verified.data.user.id,email:verified.data.user.email,email_confirmed_at:verified.data.user.email_confirmed_at},supabaseConfiguration().url,v.local_password,v.setup_token,v.name);
    await transaction(null,db=>db.query("UPDATE login_attempts SET attempts=0 WHERE key='supabase'"));
    return NextResponse.json({ok:true});
  }catch(error){await client.auth.signOut({scope:'local'});throw error;}
}
