import { transaction } from '@/server/db';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(){try{await transaction(null,db=>db.query('SELECT 1'));return Response.json({ok:true});}catch{return Response.json({ok:false},{status:503});}}
