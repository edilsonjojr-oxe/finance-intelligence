'use client';
import type { Account } from '@/lib/types';

export const accountTypeLabel: Record<string, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro',
  investment: 'Investimento',
  credit_card: 'Cartão de crédito',
  receivable: 'A receber',
};
export const cardBrands = ['Mastercard', 'Visa', 'Elo', 'American Express', 'Hipercard', 'Outra'];

type CardValues = Partial<Pick<Account, 'card_brand' | 'card_holder' | 'card_last4' | 'closing_day' | 'due_day' | 'credit_limit'>>;

/** Campos do cartão (nomes iguais aos do servidor). Todos opcionais, para completar depois. */
export function CardFields({ values = {} }: { values?: CardValues }) {
  const limit = values.credit_limit ? values.credit_limit.replace('.', ',') : '';
  return (
    <div className="form-grid">
      <label className="field">
        <span>Bandeira</span>
        <select name="card_brand" defaultValue={values.card_brand || ''}>
          <option value="">Não informada</option>
          {cardBrands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Titular do cartão</span>
        <input name="card_holder" maxLength={80} defaultValue={values.card_holder || ''} placeholder="Nome impresso no cartão" />
      </label>
      <label className="field">
        <span>4 últimos dígitos</span>
        <input name="card_last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={values.card_last4 || ''} placeholder="1234" />
      </label>
      <label className="field">
        <span>Limite (R$)</span>
        <input name="credit_limit" inputMode="decimal" pattern="[0-9.,]*" maxLength={18} defaultValue={limit} placeholder="Opcional" />
      </label>
      <label className="field">
        <span>Dia de fechamento</span>
        <input name="closing_day" type="number" min={1} max={31} defaultValue={values.closing_day ?? ''} />
      </label>
      <label className="field">
        <span>Dia de vencimento</span>
        <input name="due_day" type="number" min={1} max={31} defaultValue={values.due_day ?? ''} />
      </label>
    </div>
  );
}

/** Rótulo curto para listas: "Nome · Mastercard •1234". */
export function accountLabel(a: Pick<Account, 'name' | 'type' | 'card_brand' | 'card_last4'>) {
  if (a.type !== 'credit_card') return a.name;
  const extra = [a.card_brand, a.card_last4 ? `•${a.card_last4}` : ''].filter(Boolean).join(' ');
  return extra && !a.name.includes(a.card_last4 || '¤') ? `${a.name} · ${extra}` : a.name;
}
