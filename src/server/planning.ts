// Orçamentos mensais por categoria e metas de economia (dentro da transação do usuário).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './auth';
import type { DB } from './db';
import { audit } from './finance-service';
import { cents, validDate } from '../lib/money';
import { cleanCategory } from '../lib/categorize';

const money = z.string().regex(/^\d{1,11}(\.\d{1,2})?$/).refine((v) => cents(v) > 0n, 'O valor deve ser positivo.');
const id = z.string().uuid();

export async function planningAction(db: DB, user: string, action: string, payload: unknown) {
  if (action === 'budget.set') {
    const v = z.object({ category: z.string().trim().min(1).max(80), amount: money }).parse(payload);
    const category = cleanCategory(v.category);
    if (!category) throw new AppError('Informe a categoria.');
    await db.query('INSERT INTO budgets(user_id,category,amount) VALUES($1,$2,$3) ON CONFLICT (user_id,category) DO UPDATE SET amount=EXCLUDED.amount', [user, category, v.amount]);
    await audit(db, user, action, user, { category, amount: v.amount });
    return { id: category };
  }
  if (action === 'budget.delete') {
    const v = z.object({ category: z.string().trim().min(1).max(80) }).parse(payload);
    await db.query('DELETE FROM budgets WHERE user_id=$1 AND category=$2', [user, v.category]);
    await audit(db, user, action, user, { category: v.category });
    return { id: v.category };
  }
  if (action === 'goal.create' || action === 'goal.update') {
    const v = z.object({
      id: id.optional(), name: z.string().trim().min(1).max(80), target: money,
      saved: z.string().regex(/^\d{1,11}(\.\d{1,2})?$/).default('0'),
      deadline: z.string().refine((d) => !d || validDate(d), 'Data inválida.').default(''),
      account_id: z.union([id, z.literal('')]).default(''),
    }).parse(payload);
    if (v.account_id) {
      const acc = await db.query('SELECT 1 FROM accounts WHERE id=$1 AND user_id=$2', [v.account_id, user]);
      if (!acc.rows.length) throw new AppError('Conta não encontrada.', 404);
    }
    if (action === 'goal.create') {
      const key = randomUUID();
      await db.query('INSERT INTO goals(id,user_id,name,target,saved,deadline,account_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [key, user, v.name, v.target, v.saved, v.deadline || null, v.account_id || null]);
      await audit(db, user, action, key);
      return { id: key };
    }
    if (!v.id) throw new AppError('Meta não informada.');
    const r = await db.query('UPDATE goals SET name=$1,target=$2,saved=$3,deadline=$4,account_id=$5 WHERE id=$6 AND user_id=$7 RETURNING id', [v.name, v.target, v.saved, v.deadline || null, v.account_id || null, v.id, user]);
    if (!r.rows.length) throw new AppError('Meta não encontrada.', 404);
    await audit(db, user, action, v.id);
    return { id: v.id };
  }
  if (action === 'goal.delete') {
    const v = z.object({ id }).parse(payload);
    const r = await db.query('DELETE FROM goals WHERE id=$1 AND user_id=$2 RETURNING id', [v.id, user]);
    if (!r.rows.length) throw new AppError('Meta não encontrada.', 404);
    await audit(db, user, action, v.id);
    return { id: v.id };
  }
  throw new AppError('Operação não reconhecida.', 404);
}
