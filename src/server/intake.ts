import { randomUUID } from 'node:crypto';
import { type DB } from './db';
import { AppError,hash } from './auth';
import { audit,insertMovement } from './finance-service';
import { intakeSchema,financialDescription,type IntakeItem } from '../lib/intake';
import { cents } from '../lib/money';
import type { Obligation,Movement } from '../lib/types';
export async function recordIntakeItem(db:DB,user:string,item:IntakeItem,source:{type:string;hash:string;account?:string;fingerprint?:string}) {
  const fingerprint=source.fingerprint||hash(`${source.type}:${source.hash}:${item.key}`);
  const seen=await db.query('SELECT id FROM source_events WHERE user_id=$1 AND fingerprint=$2',[user,fingerprint]);
  if(seen.rows.length)return {duplicate:true};
  const sourceId=randomUUID();let obligationId=item.obligation_id||null,transactionId=item.transaction_id||null;
  let obligation:Obligation|undefined;
  if(obligationId) {
    obligation=(await db.query<Obligation>('SELECT id,amount::text,kind,due_date::text,status,settled_transaction_id FROM obligations WHERE user_id=$1 AND id=$2 FOR UPDATE',[user,obligationId])).rows[0];
    if(!obligation)throw new AppError('Compromisso não encontrado.',404);
    if(obligation.status==='cancelled'||cents(obligation.amount)!==cents(item.amount)||obligation.kind!==item.kind)throw new AppError('O compromisso precisa estar ativo e ter o mesmo valor e tipo.');
    if(item.event_type!=='paid'&&obligation.due_date!==item.date)throw new AppError('O vencimento deve corresponder ao compromisso selecionado.');
    if(item.event_type==='paid'&&obligation.status==='paid'&&source.account) {
      const paid=await db.query('SELECT id FROM transactions WHERE id=$1 AND user_id=$2 AND account_id=$3',[obligation.settled_transaction_id,user,source.account]);
      if(!paid.rows.length)throw new AppError('O compromisso foi pago por outra conta. Confira a origem antes de conciliar.',409);
    }
  } else {
    const matches=await db.query("SELECT id FROM obligations WHERE user_id=$1 AND amount=$2 AND kind=$3 AND due_date=$4 AND status<>'cancelled'",[user,item.amount,item.kind,item.date]);
    if(matches.rows.length&&!item.confirm_distinct)throw new AppError('Existe um compromisso com o mesmo valor e vencimento. Vincule-o ou confirme que é distinto.',409);
  }
  if(item.event_type==='paid') {
    if(obligation?.status==='paid') {
      if(transactionId&&transactionId!==obligation.settled_transaction_id)throw new AppError('O compromisso já tem outro pagamento.',409);
      transactionId=obligation.settled_transaction_id;
    } else {
      if(transactionId) {
        const t=(await db.query<Movement>("SELECT id,amount::text,kind,account_id,date::text FROM transactions WHERE id=$1 AND user_id=$2 AND status='posted' FOR UPDATE",[transactionId,user])).rows[0];
        if(!t||cents(t.amount)!==cents(item.amount)||t.kind!==item.kind||(source.account&&source.account!==t.account_id))throw new AppError('Pagamento incompatível com o evento.');
        const linked=await db.query('SELECT id FROM obligations WHERE user_id=$1 AND settled_transaction_id=$2',[user,transactionId]);
        if(linked.rows.length)throw new AppError('Pagamento já vinculado. Selecione o compromisso correspondente.',409);
      } else {
        if(!source.account)throw new AppError('Selecione a conta para registrar o pagamento.');
        const matches=await db.query("SELECT id FROM transactions WHERE user_id=$1 AND account_id=$2 AND date=$3 AND amount=$4 AND kind=$5 AND status='posted'",[user,source.account,item.date,item.amount,item.kind]);
        if(matches.rows.length&&!item.confirm_distinct)throw new AppError('Há pagamento com mesmo valor, data e conta. Vincule-o ou confirme que são distintos.',409);
        transactionId=await insertMovement(db,user,{account_id:source.account,kind:item.kind,amount:item.amount,date:item.date,competence:obligation?.due_date||item.date,description:financialDescription(item.description),category:item.category},{source:`evidence:${sourceId}`,fingerprint});
      }
      if(obligationId)await db.query("UPDATE obligations SET status='paid',settled_transaction_id=$1 WHERE user_id=$2 AND id=$3",[transactionId,user,obligationId]);
    }
  } else {
    if(transactionId)throw new AppError('Somente um evento pago pode vincular um pagamento.');
    if(!obligationId) {
      obligationId=randomUUID();
      await db.query('INSERT INTO obligations(id,user_id,description,amount,due_date,kind,category,stage) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[obligationId,user,financialDescription(item.description),item.amount,item.date,item.kind,item.category,item.event_type]);
    } else if(obligation?.status==='open'&&item.event_type==='charged') {
      await db.query("UPDATE obligations SET stage='charged' WHERE id=$1 AND user_id=$2",[obligationId,user]);
    } else if(obligation?.status==='open'&&item.event_type==='predicted') {
      await db.query("UPDATE obligations SET stage='predicted' WHERE id=$1 AND user_id=$2 AND stage='estimated'",[obligationId,user]);
    }
  }
  await db.query('INSERT INTO source_events(id,user_id,source_type,fingerprint,source_hash,event_type,obligation_id,transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[sourceId,user,source.type,fingerprint,source.hash,item.event_type,obligationId,transactionId]);
  await audit(db,user,'intake.confirmed',sourceId,{source_type:source.type,event_type:item.event_type});
  return {duplicate:false,obligationId,transactionId};
}
export async function confirmIntake(db:DB,user:string,payload:unknown) {
  const input=intakeSchema.parse(payload);
  if(input.source_type==='email')throw new AppError('Conector de e-mail ainda não habilitado. Cole o texto autorizado na entrada de conversa.');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user]);
  let count=0,skipped=0;
  for(const item of input.items) {
    const result=await recordIntakeItem(db,user,item,{type:input.source_type,hash:input.source_hash,account:input.account_id});
    if(result.duplicate)skipped++;else count++;
  }
  return {id:randomUUID(),count,skipped};
}
export async function cleanupDrafts(db:DB,user:string) {
  await db.query("UPDATE import_batches SET status='expired' WHERE user_id=$1 AND status='review' AND expires_at<now()",[user]);
  await db.query("DELETE FROM import_candidates WHERE user_id=$1 AND batch_id IN (SELECT id FROM import_batches WHERE user_id=$1 AND status IN ('expired','discarded','committed'))",[user]);
}
