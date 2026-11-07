-- Divisão de um lançamento entre categorias (ex.: compra no mercado = comida + limpeza +
-- cama, mesa e banho). O lançamento continua único; a soma das partes é validada no serviço.
CREATE TABLE IF NOT EXISTS transaction_splits (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 transaction_id uuid NOT NULL,
 category text NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
 amount numeric(18,2) NOT NULL CHECK (amount > 0),
 description text NOT NULL DEFAULT '' CHECK (length(description) <= 160),
 position integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (transaction_id, user_id) REFERENCES transactions(id, user_id)
);
CREATE INDEX IF NOT EXISTS transaction_splits_owner ON transaction_splits(user_id, transaction_id);
ALTER TABLE transaction_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_splits FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_splits' AND policyname = 'owner_access') THEN
    CREATE POLICY owner_access ON transaction_splits
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    GRANT SELECT, INSERT, DELETE ON transaction_splits TO finance_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON transaction_splits FROM anon, authenticated;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES(6);
