import { z } from 'zod';
import { cents, validDate } from './money';
const money=z.string().regex(/^\d{1,11}(\.\d{1,2})?$/).refine(v=>cents(v)>0n);
const date=z.string().refine(validDate,'Informe uma data válida.');
export const contractDetailsSchema=z.object({
  contract_type:z.enum(['service','rent','loan','financing','subscription','other']).default('service'),
  total_amount:money.nullable().optional(),end_date:date.nullable().optional(),renewal_date:date.nullable().optional(),
  interest_rate:z.string().regex(/^\d{1,5}(\.\d{1,6})?$/).nullable().optional(),
  cet:z.string().regex(/^\d{1,5}(\.\d{1,6})?$/).nullable().optional(),
  rate_period:z.enum(['monthly','annual']).default('monthly'),
  cet_period:z.enum(['monthly','annual']).default('annual'),
  penalty_note:z.string().trim().max(500).default(''),
});
export const intakeItemSchema=z.object({
  key:z.string().min(1).max(80),description:z.string().trim().min(1).max(160),amount:money,date,
  kind:z.enum(['income','expense']),category:z.string().trim().min(1).max(80),
  event_type:z.enum(['predicted','charged','paid','estimated']),
  obligation_id:z.string().uuid().optional(),transaction_id:z.string().uuid().optional(),
  confirm_distinct:z.boolean().default(false),
}).strict();
export const intakeSchema=z.object({
  source_type:z.enum(['document','conversation','email']),
  source_hash:z.string().regex(/^[a-f0-9]{64}$/),
  account_id:z.string().uuid().optional(),
  items:z.array(intakeItemSchema).min(1).max(300),
}).strict();
export type IntakeItem=z.infer<typeof intakeItemSchema>;
export type IntakeInput=z.infer<typeof intakeSchema>;
export type ExtractedItem=Omit<IntakeItem,'confirm_distinct'> & {confirm_distinct?:boolean};

export function obligationStage(o:{status:string;stage?:string;due_date:string},today:string) {
  if(o.status==='paid')return 'Pago';if(o.status==='cancelled')return 'Cancelado';
  if(o.stage==='estimated')return 'Estimado';
  if(o.due_date<today)return 'Vencido';
  return o.stage==='charged'?'Cobrado':'Previsto';
}
/** Remove identificadores que não são necessários para descrever uma despesa. */
export function financialDescription(value:string) {
  return value.replace(/\b(?:\d[ -]?){13,19}\b/g,'[identificador removido]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,'[CPF removido]').trim().slice(0,160);
}
