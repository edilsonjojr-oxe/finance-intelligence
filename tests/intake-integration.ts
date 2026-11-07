import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { database,transaction,type DB } from '../src/server/db';
import { migrationSQL } from '../src/server/migrations';
import { authenticate,authStatus,hash } from '../src/server/auth';
import { financeAction,getFinance } from '../src/server/finance-service';
import { collectSnapshot,createBackup,decryptSnapshot,restoreSnapshot,backupTables } from '../src/server/backup';
import { localToday,addDays } from '../src/lib/money';
let checks=0;
const pass=(s:string)=>{checks++;console.log('PASS '+s);};
async function main(){
  process.env.DATABASE_URL='';delete process.env.SETUP_TOKEN;delete process.env.CLOUD_DEPLOYMENT;
  const directory=path.resolve('.data',`test-intake-${randomUUID()}`);
  process.env.FINANCE_DATA_DIR=directory;
  // Simula banco v1 com registros, depois usa a inicialização real da v2.
  const previous=new PGlite(directory);await previous.waitReady;await previous.exec(await migrationSQL(0));
  const owner=randomUUID(),account=randomUUID(),today=localToday();
  await previous.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[owner,'Sintético','migration@example.invalid','unused-test-hash']);
  await previous.query('INSERT INTO accounts(id,user_id,name,type,opening_balance,opening_date) VALUES($1,$2,$3,$4,$5,$6)',[account,owner,'Conta teste','checking','1000.00',addDays(today,-30)]);
  const oldId=randomUUID();await previous.query("INSERT INTO transactions(id,user_id,account_id,kind,amount,date,competence,description,category) VALUES($1,$2,$3,'income',12.34,$4,$4,'Pré-migração','Outros')",[oldId,owner,account,today]);
  await previous.close();
  let state=await getFinance(owner);
  assert.equal(state.accounts[0].balance,'1012.34');assert.equal(state.transactions[0].id,oldId);
  pass('Migração 1 → 2 conserva IDs, lançamentos e saldo');
  const contract=await financeAction(owner,'contract.create',{title:'Mensalidade sintética',counterparty:'Instituição sintética',amount:'120.00',total_amount:'240.00',start_date:today,months:2,due_day:Number(today.slice(8)),category:'Educação',adjustment_note:'IPCA anual',interest_rate:'1.5',cet:'2.00',rate_period:'monthly',penalty_note:'2%',source_hash:hash('contrato-sintético')});
  state=await getFinance(owner);const o=state.obligations.find(o=>o.contract_id===contract.id&&o.due_date===today)!;
  assert.ok(o);assert.equal(state.contracts[0].total_amount,'240.00');
  const item={key:'1',description:'Mensalidade',amount:'120.00',date:today,kind:'expense',category:'Educação',obligation_id:o.id};
  const intake=(key:string,event_type:string,extra:Record<string,unknown>={})=>financeAction(owner,'intake.confirm',{source_type:'document',source_hash:hash(key),account_id:account,items:[{...item,event_type,...extra}]});
  await intake('cobrança','charged');state=await getFinance(owner);
  assert.equal(state.obligations.find(v=>v.id===o.id)!.stage,'charged');assert.equal(state.transactions.length,1);
  await intake('comprovante','paid');await intake('extrato','paid');await intake('extrato','paid');state=await getFinance(owner);
  assert.equal(state.transactions.length,2);assert.equal(state.obligations.length,2);assert.equal(state.accounts[0].balance,'892.34');assert.equal(state.obligations.find(v=>v.id===o.id)!.status,'paid');
  pass('Contrato → cobrança → comprovante → extrato: uma obrigação e um pagamento');
  await assert.rejects(()=>intake('duplicado-sem-vínculo','paid',{obligation_id:undefined}));
  await assert.rejects(()=>intake('valor-incompatível','paid',{amount:'121.00'}));
  await assert.rejects(()=>financeAction(owner,'intake.confirm',{source_type:'email',source_hash:hash('email'),items:[{...item,event_type:'charged'}]}));
  await assert.rejects(()=>financeAction(owner,'intake.confirm',{source_type:'document',source_hash:hash('raw'),text:'raw document',items:[{...item,event_type:'charged'}]}));
  const other=randomUUID();await transaction(null,db=>db.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[other,'Outro','other@example.invalid','unused-test-hash']));
  await assert.rejects(()=>financeAction(other,'intake.confirm',{source_type:'document',source_hash:hash('cross-user'),items:[{...item,event_type:'charged'}]}));
  pass('Rejeita duplicidade ambígua, vínculo inválido, e-mail não conectado, texto bruto e outro proprietário');
  const before=(await getFinance(owner)).obligations.length;
  await assert.rejects(()=>financeAction(owner,'intake.confirm',{source_type:'conversation',source_hash:hash('rollback'),items:[{...item,key:'first',obligation_id:undefined,amount:'9.99',event_type:'estimated'},{...item,key:'second',amount:'99.99',event_type:'charged'}]}));
  assert.equal((await getFinance(owner)).obligations.length,before);
  pass('Conciliação em lote reverte integralmente quando um item falha');
  const stage=()=>financeAction(owner,'import.stage',{account_id:account,filename:'NAO-PERSISTIR-NOME.csv',format:'csv',content:`data;descricao;valor\n${today};Rascunho;-5,00`});
  const batch=await stage();state=await getFinance(owner);let candidate=state.candidates.find(c=>c.batch_id===batch.id)!;
  await financeAction(owner,'import.update',{id:candidate.id,date:today,description:'Corrigido',amount:'7.00',kind:'expense',category:'Outros'});
  await financeAction(owner,'import.commit',{id:batch.id,selected:[candidate.id]});state=await getFinance(owner);
  assert.equal(state.candidates.filter(c=>c.batch_id===batch.id).length,0);assert.ok(state.transactions.some(t=>t.description==='Corrigido'&&t.amount==='7.00'));
  const dropped=await stage();await financeAction(owner,'import.discard',{id:dropped.id});
  const expired=await stage();await transaction(owner,db=>db.query("UPDATE import_batches SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]));
  state=await getFinance(owner);assert.equal(state.candidates.length,0);assert.equal(state.batches.find(b=>b.id===expired.id)!.status,'expired');assert.equal(state.transactions.length,3);
  const snap=await transaction(owner,db=>collectSnapshot(db,owner));assert.ok(!JSON.stringify(snap).includes('NAO-PERSISTIR-NOME'));assert.ok(!('import_candidates' in snap.tables));assert.ok(!('sessions' in snap.tables));
  pass('Correção, confirmação, descarte e expiração removem candidatos e preservam movimentos');
  const secondAccount=await financeAction(owner,'account.create',{name:'Conta independente',institution:'Outro banco sintético',type:'checking',opening_balance:'0.00',opening_date:today});
  async function importBankId(account_id:string){
    const b=await financeAction(owner,'import.stage',{account_id,filename:'isolamento.csv',format:'csv',content:`data;descricao;valor;id\n${today};Movimento identificado;-13,77;mesmo-id-bancario`});
    const candidates=(await getFinance(owner)).candidates.filter(c=>c.batch_id===b.id);
    return financeAction(owner,'import.commit',{id:b.id,selected:candidates.map(c=>c.id)});
  }
  await importBankId(account);await importBankId(secondAccount.id);
  state=await getFinance(owner);
  assert.equal(state.transactions.filter(t=>t.description==='Movimento identificado').length,2,'Identificadores bancários são únicos na conta, não globalmente no perfil');
  assert.equal(state.accounts.find(a=>a.id===secondAccount.id)!.balance,'-13.77');
  await importBankId(secondAccount.id);
  assert.equal((await getFinance(owner)).transactions.length,state.transactions.length);
  pass('Mesmo identificador bancário em contas distintas preserva os dois movimentos e bloqueia repetição na mesma conta');
  const secret='Synthetic-backup-password-123!';const encrypted=await createBackup(owner,secret);
  assert.ok(!encrypted.includes('Mensalidade sintética'));
  await assert.rejects(()=>decryptSnapshot(encrypted,'wrong-password'));
  const tampered=JSON.parse(encrypted);const bytes=Buffer.from(tampered.data,'base64');bytes[0]^=1;tampered.data=bytes.toString('base64');await assert.rejects(()=>decryptSnapshot(JSON.stringify(tampered),secret));
  const snapshot=await decryptSnapshot(encrypted,secret);assert.equal(snapshot.tables.users.length,1);
  const restored=new PGlite();await restored.waitReady;
  for(let i=0;i<2;i++)await restored.exec(await migrationSQL(i));
  try {
    await restored.transaction(tx=>restoreSnapshot(tx as DB,snapshot));
    for(const table of backupTables){const count=await restored.query<{n:number}>(`SELECT count(*)::int AS n FROM ${table}`);assert.equal(count.rows[0].n,snapshot.tables[table].length);}
    const relationship=await restored.query<{id:string}>('SELECT t.id FROM obligations o JOIN transactions t ON t.id=o.settled_transaction_id WHERE o.id=$1',[o.id]);assert.equal(relationship.rows.length,1);
    await assert.rejects(()=>restored.transaction(tx=>restoreSnapshot(tx as DB,snapshot)));
  }finally{await restored.close();}
  pass('Backup AES-GCM: autenticação, senha incorreta, adulteração e restauração íntegra em base vazia');
  await transaction(owner,async db=>{
    await db.query('CREATE ROLE fi_source_restricted NOLOGIN NOSUPERUSER NOBYPASSRLS');await db.query('GRANT SELECT ON source_events TO fi_source_restricted');await db.query('SET LOCAL ROLE fi_source_restricted');
    assert.ok((await db.query('SELECT id FROM source_events')).rows.length>0);await db.query("SELECT set_config('app.user_id',$1,true)",[other]);assert.equal((await db.query('SELECT id FROM source_events')).rows.length,0);
  });pass('RLS também protege as evidências estruturadas entre usuários');
  const db=await database();if(db.mode==='local')await db.client.close();
  // Cadastro nuvem: exige segredo mesmo antes da primeira conta.
  process.env.CLOUD_DEPLOYMENT='true';process.env.SETUP_TOKEN='test-activation-code-with-32-characters';
  await assert.rejects(()=>authenticate('setup','cloud@example.invalid','Synthetic-password-123!','Nuvem','wrong'),/ativação/);
  delete process.env.CLOUD_DEPLOYMENT;delete process.env.SETUP_TOKEN;pass('Cadastro público recusa código de ativação inválido');
  console.log(`${checks} cenários novos aprovados; somente dados sintéticos.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
