export type Account = {
  id: string;
  name: string;
  institution: string;
  type: string;
  opening_balance: string;
  opening_date: string;
  balance: string;
  card_brand?: string | null;
  card_holder?: string | null;
  card_last4?: string | null;
  closing_day?: number | null;
  due_day?: number | null;
  credit_limit?: string | null;
};
export type Movement = {
  id: string;
  account_id: string;
  destination_account_id: string | null;
  kind: "income" | "expense" | "transfer";
  amount: string;
  date: string;
  competence: string;
  description: string;
  category: string;
  status: "posted" | "reversed";
  source: string;
};
export type Obligation = {
  id: string;
  contract_id: string | null;
  description: string;
  amount: string;
  due_date: string;
  kind: "income" | "expense";
  category: string;
  status: "open" | "paid" | "cancelled";
  stage?: "predicted" | "charged" | "estimated";
  settled_transaction_id: string | null;
};
export type Contract = {
  id: string;
  title: string;
  counterparty: string;
  amount: string;
  start_date: string;
  months: number;
  due_day: number;
  category: string;
  adjustment_note: string;
  contract_type?:string; total_amount?:string|null; end_date?:string|null;
  renewal_date?:string|null; interest_rate?:string|null; cet?:string|null;
  rate_period?:string; cet_period?:string; penalty_note?:string;
};
export type Candidate = {
  id: string;
  batch_id: string;
  date: string;
  description: string;
  amount: string;
  kind: "income" | "expense";
  category: string;
  fingerprint: string;
  duplicate: "new" | "possible" | "exact";
  obligation_id?:string|null;
};
export type Batch = {
  id: string;
  filename: string;
  account_id: string;
  status: string;
  created_at: string;
};
export type ForecastPoint = {
  date: string;
  balance: string;
  income: string;
  expense: string;
};
export type FinanceState = {
  accounts: Account[];
  transactions: Movement[];
  obligations: Obligation[];
  contracts: Contract[];
  batches: Batch[];
  candidates: Candidate[];
  audit: {
    id: string;
    action: string;
    created_at: string;
    details: Record<string, unknown>;
  }[];
  today: string;
  storage: "local" | "postgres";
  /** Categorias criadas pelo usuário (as prontas ficam em lib/categorize). */
  categories: string[];
};
