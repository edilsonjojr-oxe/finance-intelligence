-- Cartões de crédito como contas (compras = despesas no cartão; pagamento da fatura =
-- transferência da conta corrente para o cartão) e categorias personalizadas por usuário.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('checking','savings','cash','investment','credit_card'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS card_brand text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS card_holder text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS card_last4 text CHECK (card_last4 ~ '^[0-9]{4}$');
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS closing_day integer CHECK (closing_day BETWEEN 1 AND 31);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS due_day integer CHECK (due_day BETWEEN 1 AND 31);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credit_limit numeric(18,2) CHECK (credit_limit >= 0);

CREATE TABLE IF NOT EXISTS categories (
 user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, name)
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'owner_access') THEN
    CREATE POLICY owner_access ON categories
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    GRANT SELECT, INSERT, DELETE ON categories TO finance_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON categories FROM anon, authenticated;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES(5);
