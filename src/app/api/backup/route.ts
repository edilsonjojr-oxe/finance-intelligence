import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUser,sessionCookie } from '@/server/auth';
import { readBody,errorResponse } from '@/server/http';
import { createBackup } from '@/server/backup';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
  try{const user=await requireUser(request.cookies.get(sessionCookie)?.value);
    const {passphrase}=z.object({passphrase:z.string().min(12).max(128)}).strict().parse(await readBody(request));
    return new Response(await createBackup(user.id,passphrase),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="finance-backup.fib"','Cache-Control':'no-store'}});
  }catch(error){return errorResponse(error);}
}
