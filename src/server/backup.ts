import { createCipheriv,createDecipheriv,randomBytes,scrypt as derive } from 'node:crypto';
import { promisify } from 'node:util';
import { transaction,type DB } from './db';
import { AppError } from './auth';
const scrypt=promisify(derive);
export const backupTables=['users','accounts','transactions','contracts','obligations','import_batches','source_events','audit_events','categories'] as const;
// Tabelas acrescentadas depois da v2: backups antigos sem elas continuam restauráveis.
const optionalBackupTables=new Set<string>(['categories']);
export type Snapshot={version:2;created_at:string;tables:Record<string,Record<string,unknown>[]>};
export async function collectSnapshot(db:DB,user:string):Promise<Snapshot> {
  const tables:Snapshot['tables']={};
  for(const table of backupTables){
    // Lista estática. Inclui perfil e hash de senha para restauração; nunca inclui sessões/tokens.
    tables[table]=(await db.query(`SELECT * FROM ${table} WHERE ${table==='users'?'id':'user_id'}=$1`,[user])).rows;
    if(table==='import_batches')tables[table]=tables[table].map(row=>({...row,status:row.status==='review'?'discarded':row.status}));
  }
  return {version:2,created_at:new Date().toISOString(),tables};
}
export async function encryptSnapshot(snapshot:Snapshot,passphrase:string) {
  if(passphrase.length<12||passphrase.length>128)throw new AppError('Use uma senha de backup com 12 a 128 caracteres.');
  const salt=randomBytes(16),iv=randomBytes(12),key=await scrypt(passphrase,salt,32) as Buffer;
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('FinanceIntelligenceBackup:v2'));
  const plain=Buffer.from(JSON.stringify(snapshot));
  try{if(plain.length>25_000_000)throw new AppError('Base excede 25 MB. Use o backup PostgreSQL gerenciado.');
    const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
    return JSON.stringify({format:'fi-backup-v2',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')});
  }finally{key.fill(0);plain.fill(0);}
}
export async function decryptSnapshot(content:string,passphrase:string):Promise<Snapshot> {
  if(content.length>35_000_000)throw new Error('Backup excede o limite.');
  const input=JSON.parse(content);
  if(input.format!=='fi-backup-v2'||typeof input.data!=='string')throw new Error('Formato de backup inválido.');
  const salt=Buffer.from(input.salt,'base64'),iv=Buffer.from(input.iv,'base64'),tag=Buffer.from(input.tag,'base64');
  if(salt.length!==16||iv.length!==12||tag.length!==16)throw new Error('Backup inválido.');
  const key=await scrypt(passphrase,salt,32) as Buffer;
  let plain:Buffer|undefined;
  try{const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('FinanceIntelligenceBackup:v2'));cipher.setAuthTag(tag);
    plain=Buffer.concat([cipher.update(Buffer.from(input.data,'base64')),cipher.final()]);
    const result=JSON.parse(plain.toString('utf8')) as Snapshot;
    if(result.version!==2||!result.tables||!Array.isArray(result.tables.users)||result.tables.users.length!==1)throw new Error('Conteúdo de backup inválido.');
    return result;
  }finally{key.fill(0);plain?.fill(0);}
}
export async function restoreSnapshot(db:DB,snapshot:Snapshot) {
  const existing=await db.query('SELECT id FROM users LIMIT 1');
  if(existing.rows.length)throw new Error('Restauração permitida somente em uma base vazia.');
  const owner=snapshot.tables.users[0].id;
  for(const table of backupTables) {
    const rows=snapshot.tables[table];if(!Array.isArray(rows)){if(optionalBackupTables.has(table))continue;throw new Error('Tabela ausente no backup.');}
    const columns=(await db.query<{column_name:string}>('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1',[table])).rows.map(c=>c.column_name);
    for(const row of rows) {
      if((table==='users'?row.id:row.user_id)!==owner)throw new Error('Proprietário incompatível no backup.');
      const keys=Object.keys(row);if(keys.some(key=>!columns.includes(key)))throw new Error('Coluna incompatível com o esquema.');
      await db.query(`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k]):row[k]));
    }
  }
}
export async function createBackup(user:string,passphrase:string) {
  const snapshot=await transaction(user,db=>collectSnapshot(db,user),true);
  return encryptSnapshot(snapshot,passphrase);
}
