import { randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, database, type DB } from "./db";
import { AppError, hash } from "./auth";
import {
  cents,
  decimal,
  localToday,
  validDate,
  recurrenceDates,
} from "../lib/money";
import { balanceFor } from "../lib/finance";
import type {
  Account,
  Movement,
  Obligation,
  Contract,
  Candidate,
  Batch,
  FinanceState,
} from "../lib/types";
import { parseImport } from "./imports";
import { contractDetailsSchema, financialDescription } from "../lib/intake";
const id = z.string().uuid();
const text = z.string().trim().min(1).max(300);
const money = z
  .string()
  .regex(/^\d{1,11}(\.\d{1,2})?$/)
  .refine((v) => cents(v) > 0n, "O valor deve ser positivo.");
const date = z.string().refine(validDate, "Data inválida.");
const category = z.string().trim().min(1).max(80);
const movementSchema = z.object({
  account_id: id,
  destination_account_id: id.optional(),
  kind: z.enum(["income", "expense", "transfer"]),
  amount: money,
  date,
  competence: date,
  description: text,
  category,
});
export async function audit(
  db: DB,
  user: string,
  action: string,
  entity: string,
  details: Record<string, unknown> = {},
) {
  await db.query(
    "INSERT INTO audit_events(id,user_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), user, action, entity, JSON.stringify(details)],
  );
}
async function ownedAccount(db: DB, user: string, accountId: string) {
  const result = await db.query<{ id: string; opening_date: string }>(
    "SELECT id,opening_date::text FROM accounts WHERE id=$1 AND user_id=$2",
    [accountId, user],
  );
  if (!result.rows[0]) throw new AppError("Conta não encontrada.", 404);
  return result.rows[0];
}
export async function insertMovement(
  db: DB,
  user: string,
  input: z.infer<typeof movementSchema>,
  extra: { fingerprint?: string; source?: string } = {},
) {
  const account = await ownedAccount(db, user, input.account_id);
  if (input.date < account.opening_date)
    throw new AppError(
      "A data antecede a cobertura da conta. Revise o saldo inicial.",
    );
  if (input.date > localToday())
    throw new AppError(
      "Movimentações realizadas não podem ter data futura. Cadastre um compromisso.",
    );
  if (input.kind === "transfer") {
    if (
      !input.destination_account_id ||
      input.destination_account_id === input.account_id
    )
      throw new AppError("Escolha uma conta de destino diferente.");
    const target = await ownedAccount(db, user, input.destination_account_id);
    if (input.date < target.opening_date)
      throw new AppError("A data antecede a cobertura da conta de destino.");
  }
  const movementId = randomUUID();
  await db.query(
    "INSERT INTO transactions(id,user_id,account_id,destination_account_id,kind,amount,date,competence,description,category,fingerprint,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
      movementId,
      user,
      input.account_id,
      input.kind === "transfer" ? input.destination_account_id : null,
      input.kind,
      decimal(cents(input.amount)),
      input.date,
      input.competence,
      input.description,
      input.kind === "transfer" ? "Transferência interna" : input.category,
      extra.fingerprint || null,
      extra.source || "manual",
    ],
  );
  await audit(db, user, "movement.created", movementId, {
    kind: input.kind,
    amount: input.amount,
    source: extra.source || "manual",
  });
  return movementId;
}
export async function getFinance(user: string): Promise<FinanceState> {
  return transaction(user, async (db) => {
    await (await import("./intake")).cleanupDrafts(db,user);
    const accounts = (
      await db.query<Account>(
        "SELECT id,name,institution,type,opening_balance::text,opening_date::text FROM accounts WHERE user_id=$1 ORDER BY created_at",
        [user],
      )
    ).rows;
    const transactions = (
      await db.query<Movement>(
        "SELECT id,account_id,destination_account_id,kind,amount::text,date::text,competence::text,description,category,status,source FROM transactions WHERE user_id=$1 ORDER BY date DESC,created_at DESC",
        [user],
      )
    ).rows;
    const obligations = (
      await db.query<Obligation>(
        "SELECT id,contract_id,description,amount::text,due_date::text,kind,category,status,stage,settled_transaction_id FROM obligations WHERE user_id=$1 ORDER BY due_date",
        [user],
      )
    ).rows;
    const contracts = (
      await db.query<Contract>(
        "SELECT id,title,counterparty,amount::text,start_date::text,months,due_day,category,adjustment_note,contract_type,total_amount::text,end_date::text,renewal_date::text,interest_rate::text,cet::text,rate_period,cet_period,penalty_note FROM contracts WHERE user_id=$1 ORDER BY created_at DESC",
        [user],
      )
    ).rows;
    const batches = (
      await db.query<Batch>(
        "SELECT id,filename,account_id,status,created_at::text FROM import_batches WHERE user_id=$1 ORDER BY created_at DESC",
        [user],
      )
    ).rows;
    const candidates = (
      await db.query<Candidate>(
        `SELECT c.id,c.batch_id,c.date::text,c.description,c.amount::text,c.kind,c.category,c.fingerprint,c.obligation_id,
      CASE WHEN EXISTS(SELECT 1 FROM transactions t WHERE t.user_id=c.user_id AND t.account_id=b.account_id AND t.fingerprint=c.fingerprint) THEN 'exact'
      WHEN EXISTS(SELECT 1 FROM transactions t WHERE t.user_id=c.user_id AND t.account_id=b.account_id AND t.status='posted' AND t.date=c.date AND t.amount=c.amount AND t.kind=c.kind AND lower(t.description)=lower(c.description)) THEN 'possible' ELSE 'new' END AS duplicate
      FROM import_candidates c JOIN import_batches b ON b.id=c.batch_id AND b.user_id=c.user_id WHERE c.user_id=$1 AND b.status='review' ORDER BY c.date`,
        [user],
      )
    ).rows;
    const auditRows = (
      await db.query<FinanceState["audit"][number]>(
        "SELECT id,action,created_at::text,details FROM audit_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
        [user],
      )
    ).rows;
    const today = localToday();
    return {
      accounts: accounts.map((a) => ({
        ...a,
        balance: balanceFor(a, transactions, today),
      })),
      transactions,
      obligations,
      contracts,
      batches,
      candidates,
      audit: auditRows,
      today,
      storage: (await database()).mode,
    };
  });
}
export async function financeAction(
  user: string,
  action: string,
  payload: unknown,
) {
  return transaction(user, async (db) => {
    if(action==='intake.confirm') return (await import('./intake')).confirmIntake(db,user,payload);
    if(action==='import.discard') {
      const v=z.object({id}).parse(payload);
      const rows=await db.query("UPDATE import_batches SET status='discarded' WHERE user_id=$1 AND id=$2 AND status='review' RETURNING id",[user,v.id]);
      if(!rows.rows.length)throw new AppError('Lote não está em revisão.',409);
      await (await import('./intake')).cleanupDrafts(db,user);
      await audit(db,user,action,v.id);return {id:v.id};
    }
    if(action==='import.update') {
      const v=z.object({id,date,description:text,amount:money,kind:z.enum(['income','expense']),category,obligation_id:id.nullable().optional()}).parse(payload);
      const batch=await db.query("SELECT b.id FROM import_batches b JOIN import_candidates c ON c.batch_id=b.id AND c.user_id=b.user_id WHERE c.id=$1 AND c.user_id=$2 AND b.status='review' AND b.expires_at>now() FOR UPDATE OF b",[v.id,user]);
      if(!batch.rows.length)throw new AppError('Candidato indisponível ou expirado.',409);
      if(v.obligation_id) {
        const owned=await db.query('SELECT id FROM obligations WHERE user_id=$1 AND id=$2',[user,v.obligation_id]);
        if(!owned.rows.length)throw new AppError('Compromisso não encontrado.',404);
      }
      await db.query('UPDATE import_candidates SET date=$1,description=$2,amount=$3,kind=$4,category=$5,obligation_id=$6 WHERE id=$7 AND user_id=$8',[v.date,financialDescription(v.description),v.amount,v.kind,v.category,v.obligation_id||null,v.id,user]);
      await audit(db,user,action,v.id);return {id:v.id};
    }
    if (action === "account.create") {
      const v = z
        .object({
          name: text,
          institution: z.string().trim().max(120),
          type: z.enum(["checking", "savings", "cash", "investment"]),
          opening_balance: z.string().refine((v) => {
            try {
              cents(v);
              return true;
            } catch {
              return false;
            }
          }, "Saldo inválido."),
          opening_date: date,
        })
        .parse(payload);
      if (v.opening_date > localToday())
        throw new AppError("A data do saldo inicial não pode ser futura.");
      const key = randomUUID();
      await db.query(
        "INSERT INTO accounts(id,user_id,name,institution,type,opening_balance,opening_date) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          key,
          user,
          v.name,
          v.institution,
          v.type,
          v.opening_balance,
          v.opening_date,
        ],
      );
      await audit(db, user, action, key);
      return { id: key };
    }
    if (action === "movement.create")
      return {
        id: await insertMovement(db, user, movementSchema.parse(payload)),
      };
    if (action === "movement.reverse") {
      const v = z
        .object({ id, reason: z.string().trim().min(5).max(300) })
        .parse(payload);
      const r = await db.query<{ id: string }>(
        "UPDATE transactions SET status='reversed' WHERE id=$1 AND user_id=$2 AND status='posted' RETURNING id",
        [v.id, user],
      );
      if (!r.rows.length)
        throw new AppError("Lançamento não encontrado ou já estornado.", 409);
      await db.query(
        "UPDATE obligations SET status='open',settled_transaction_id=NULL WHERE user_id=$1 AND settled_transaction_id=$2",
        [user, v.id],
      );
      await audit(db, user, action, v.id, { reason: v.reason });
      return { id: v.id };
    }
    if (action === "obligation.create") {
      const v = z
        .object({
          description: text,
          amount: money,
          due_date: date,
          kind: z.enum(["income", "expense"]),
          category,
        })
        .parse(payload);
      const key = randomUUID();
      await db.query(
        "INSERT INTO obligations(id,user_id,description,amount,due_date,kind,category) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [key, user, v.description, v.amount, v.due_date, v.kind, v.category],
      );
      await audit(db, user, action, key);
      return { id: key };
    }
    if (action === "obligation.settle") {
      const v = z
        .object({
          id,
          account_id: id.optional(),
          date: date.optional(),
          existing_transaction_id: id.optional(),
        })
        .parse(payload);
      const result = await db.query<Obligation>(
        "SELECT id,description,amount::text,kind,category,due_date::text FROM obligations WHERE user_id=$1 AND id=$2 AND status='open' FOR UPDATE",
        [user, v.id],
      );
      const o = result.rows[0];
      if (!o)
        throw new AppError("Compromisso não encontrado ou já liquidado.", 409);
      let movementId: string;
      if (v.existing_transaction_id) {
        const movements = await db.query<Movement>(
          "SELECT id,amount::text,kind FROM transactions WHERE id=$1 AND user_id=$2 AND status='posted' FOR UPDATE",
          [v.existing_transaction_id, user],
        );
        const existing = movements.rows[0];
        if (
          !existing ||
          cents(existing.amount) !== cents(o.amount) ||
          existing.kind !== o.kind
        )
          throw new AppError(
            "O movimento deve ter o mesmo valor e tipo do compromisso.",
          );
        const linked = await db.query(
          "SELECT id FROM obligations WHERE user_id=$1 AND settled_transaction_id=$2",
          [user, existing.id],
        );
        if (linked.rows.length)
          throw new AppError(
            "Este movimento já liquida outro compromisso.",
            409,
          );
        movementId = existing.id;
      } else {
        if (!v.account_id || !v.date)
          throw new AppError("Informe a conta e a data de liquidação.");
        movementId = await insertMovement(
          db,
          user,
          {
            account_id: v.account_id,
            kind: o.kind,
            amount: o.amount,
            date: v.date,
            competence: o.due_date,
            description: o.description,
            category: o.category,
          },
          { source: "obligation" },
        );
      }
      await db.query(
        "UPDATE obligations SET status='paid',settled_transaction_id=$1 WHERE user_id=$2 AND id=$3",
        [movementId, user, v.id],
      );
      await audit(db, user, action, v.id, { movementId });
      return { id: v.id };
    }
    if (action === "obligation.cancel") {
      const v = z.object({ id }).parse(payload);
      const r = await db.query(
        "UPDATE obligations SET status='cancelled' WHERE user_id=$1 AND id=$2 AND status='open' RETURNING id",
        [user, v.id],
      );
      if (!r.rows.length)
        throw new AppError("Compromisso não está aberto.", 409);
      await audit(db, user, action, v.id);
      return { id: v.id };
    }
    if (action === "contract.create") {
      const v = z
        .object({
          title: text,
          counterparty: text,
          amount: money,
          start_date: date,
          months: z.coerce.number().int().min(1).max(60),
          due_day: z.coerce.number().int().min(1).max(31),
          category,
          adjustment_note: z.string().trim().max(1000),
          source_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
          confirm_distinct:z.boolean().default(false),
        }).extend(contractDetailsSchema.shape)
        .parse(payload);
      if(v.end_date&&v.end_date<v.start_date)throw new AppError('Vigência final anterior ao início.');
      const schedule=recurrenceDates(v.start_date,v.months,v.due_day);
      if(v.end_date&&schedule.at(-1)!>v.end_date)throw new AppError('As parcelas ultrapassam a vigência informada.');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user]);
      if(v.source_hash) {
        const seen=await db.query<{contract_id:string}>("SELECT contract_id FROM source_events WHERE user_id=$1 AND fingerprint=$2",[user,hash('contract:'+v.source_hash)]);
        if(seen.rows.length)return {id:seen.rows[0].contract_id,alreadyCommitted:true};
      }
      const similar=await db.query('SELECT id FROM contracts WHERE user_id=$1 AND lower(counterparty)=lower($2) AND amount=$3 AND start_date=$4',[user,v.counterparty,v.amount,v.start_date]);
      if(similar.rows.length&&!v.confirm_distinct)throw new AppError('Contrato semelhante encontrado. Confirme se são contratos distintos.',409);
      const key = randomUUID();
      await db.query(
        "INSERT INTO contracts(id,user_id,title,counterparty,amount,start_date,months,due_day,category,adjustment_note,contract_type,total_amount,end_date,renewal_date,interest_rate,cet,rate_period,cet_period,penalty_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
        [
          key,
          user,
          v.title,
          v.counterparty,
          v.amount,
          v.start_date,
          v.months,
          v.due_day,
          v.category,
          v.adjustment_note, v.contract_type,v.total_amount||null,v.end_date||null,v.renewal_date||null,v.interest_rate||null,v.cet||null,v.rate_period,v.cet_period,v.penalty_note,
        ],
      );
      for (const due of recurrenceDates(v.start_date, v.months, v.due_day))
        await db.query(
          "INSERT INTO obligations(id,user_id,contract_id,description,amount,due_date,kind,category) VALUES($1,$2,$3,$4,$5,$6,'expense',$7)",
          [randomUUID(), user, key, v.title, v.amount, due, v.category],
        );
      if(v.source_hash)await db.query("INSERT INTO source_events(id,user_id,source_type,fingerprint,source_hash,event_type,contract_id) VALUES($1,$2,'document',$3,$4,'contract',$5)",[randomUUID(),user,hash('contract:'+v.source_hash),v.source_hash,key]);
      await audit(db, user, action, key, {
        occurrences: v.months,
        amount: v.amount,
      });
      return { id: key };
    }
    if (action === "import.stage") {
      const v = z
        .object({
          account_id: id,
          filename: text,
          format: z.enum(["csv", "ofx"]),
          content: z.string().min(1).max(2_000_000),
        })
        .parse(payload);
      await ownedAccount(db, user, v.account_id);
      const rows = parseImport(v.content, v.format);
      const key = randomUUID();
      await db.query(
        "INSERT INTO import_batches(id,user_id,account_id,filename,file_hash,format) VALUES($1,$2,$3,$4,$5,$6)",
        [key, user, v.account_id, `Importação ${v.format.toUpperCase()}`, hash(v.content), v.format],
      );
      for (const r of rows)
        await db.query(
          "INSERT INTO import_candidates(id,user_id,batch_id,date,description,amount,kind,fingerprint,category,bank_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            randomUUID(),
            user,
            key,
            r.date,
            financialDescription(r.description),
            r.amount,
            r.kind,
            r.fingerprint,
            r.category,
            r.bankId,
          ],
        );
      await audit(db, user, action, key, {
        hash: hash(v.content),
        rows: rows.length,
      });
      return { id: key };
    }
    if (action === "import.commit") {
      const v = z
        .object({
          id,
          selected: z.array(id).min(1).max(2000),
          confirmDistinct: z.boolean().default(false),
        })
        .parse(payload);
      const batches = await db.query<Batch & {format:string;file_hash:string;expires_at:string}>(
        "SELECT id,account_id,status,format,file_hash,expires_at::text FROM import_batches WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [v.id, user],
      );
      const batch = batches.rows[0];
      if (!batch) throw new AppError("Importação não encontrada.", 404);
      if (batch.status === "committed")
        return { id: v.id, alreadyCommitted: true };
      if(batch.status!=='review'||new Date(batch.expires_at)<new Date())throw new AppError('Lote descartado ou expirado. Importe novamente.',409);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user]);
      const candidates = await db.query<Candidate>(
        "SELECT id,date::text,description,amount::text,kind,category,fingerprint,obligation_id FROM import_candidates WHERE batch_id=$1 AND user_id=$2",
        [v.id, user],
      );
      const selected = new Set(v.selected);
      let count = 0,
        skipped = 0;
      if (v.selected.some((key) => !candidates.rows.some((c) => c.id === key)))
        throw new AppError("Seleção inválida.");
      for (const c of candidates.rows.filter((c) => selected.has(c.id))) {
        const exact = await db.query(
          "SELECT id FROM transactions WHERE user_id=$1 AND account_id=$2 AND fingerprint=$3",
          [user, batch.account_id, c.fingerprint],
        );
        if (exact.rows.length) {
          skipped++;
          continue;
        }
        const probable = await db.query(
          "SELECT id FROM transactions WHERE user_id=$1 AND account_id=$2 AND date=$3 AND amount=$4 AND kind=$5 AND lower(description)=lower($6) AND status='posted'",
          [user, batch.account_id, c.date, c.amount, c.kind, c.description],
        );
        if (probable.rows.length && !v.confirmDistinct && !c.obligation_id)
          throw new AppError(
            "Há possíveis duplicidades. Revise e confirme que são movimentos distintos.",
            409,
          );
        const result=await (await import('./intake')).recordIntakeItem(db,user,{
          key:c.id,description:c.description,amount:c.amount,date:c.date,kind:c.kind,category:c.category,
          event_type:'paid',obligation_id:c.obligation_id||undefined,confirm_distinct:v.confirmDistinct
        },{type:batch.format,hash:batch.file_hash,account:batch.account_id,fingerprint:c.fingerprint});
        if(result.duplicate)skipped++;else count++;
      }
      await db.query(
        "UPDATE import_batches SET status='committed' WHERE id=$1 AND user_id=$2",
        [v.id, user],
      );
      await (await import("./intake")).cleanupDrafts(db,user);
      await audit(db, user, action, v.id, { count, skipped });
      return { id: v.id, count, skipped };
    }
    throw new AppError("Operação não reconhecida.", 404);
  });
}
