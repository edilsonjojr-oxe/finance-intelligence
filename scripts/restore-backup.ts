import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { transaction,database } from '../src/server/db';
import { decryptSnapshot,restoreSnapshot } from '../src/server/backup';
async function main(){
  const [file,destination]=process.argv.slice(2);
  if(!file||!destination||!process.env.FINANCE_BACKUP_PASSPHRASE)throw new Error('Informe arquivo, novo diretório .data e FINANCE_BACKUP_PASSPHRASE pelo ambiente.');
  const target=path.resolve(destination),root=path.resolve('.data')+path.sep;
  if(!target.startsWith(root)||target===path.resolve('.data/finance'))throw new Error('Escolha uma NOVA pasta dentro de .data, diferente da base pessoal.');
  const snapshot=await decryptSnapshot(await readFile(path.resolve(file),'utf8'),process.env.FINANCE_BACKUP_PASSPHRASE);
  delete process.env.FINANCE_BACKUP_PASSPHRASE;process.env.DATABASE_URL='';process.env.FINANCE_DATA_DIR=target;
  const db=await database();
  try {await transaction(null,db=>restoreSnapshot(db,snapshot));}
  finally {if(db.mode==='local')await db.client.close();else await db.client.end();}
  console.log('Backup restaurado na base separada. A base pessoal não foi alterada.');
}
main().catch(()=>{console.error('Restauração recusada: confira senha, arquivo e destino vazio.');process.exitCode=1;});
