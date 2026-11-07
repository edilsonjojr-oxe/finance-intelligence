import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function supabaseConfiguration() {
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url || !key?.startsWith('sb_publishable_'))throw new Error('Configure URL e chave publicável do Supabase.');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/')throw new Error('URL Supabase inválida.');
  return {url:parsed.origin,key};
}

// Cliente por requisição. Nenhum token/chave secreta é exposto ao JavaScript do navegador.
export async function supabaseServerClient() {
  const {url,key}=supabaseConfiguration(),store=await cookies();
  return createServerClient(url,key,{
    cookieOptions:{httpOnly:true,sameSite:'lax',secure:process.env.COOKIE_SECURE==='true',path:'/'},
    cookies:{getAll:()=>store.getAll(),setAll:values=>{
      try{for(const {name,value,options} of values)store.set(name,value,{...options,httpOnly:true});}
      catch{/* Server Components: o Proxy já renovou e propagou os cookies. */}
    }},
  });
}
