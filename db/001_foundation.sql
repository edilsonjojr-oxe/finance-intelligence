CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_attempts (
 key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 institution text NOT NULL DEFAULT '', type text NOT NULL CHECK (type IN ('checking','savings','cash','investment')),
 opening_balance numeric(18,2) NOT NULL, opening_date date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS transactions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), account_id uuid NOT NULL,
 destination_account_id uuid, kind text NOT NULL CHECK (kind IN ('income','expense','transfer')),
 amount numeric(18,2) NOT NULL CHECK(amount > 0), date date NOT NULL, competence date NOT NULL,
 description text NOT NULL, category text NOT NULL,
 status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed')),
 fingerprint text, source text NOT NULL DEFAULT 'manual', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id),
 FOREIGN KEY(destination_account_id,user_id) REFERENCES accounts(id,user_id),
 CHECK ((kind = 'transfer' AND destination_account_id IS NOT NULL AND destination_account_id <> account_id) OR (kind <> 'transfer' AND destination_account_id IS NULL)),
 UNIQUE(user_id,account_id,fingerprint), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS contracts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), title text NOT NULL,
 counterparty text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount > 0),
 start_date date NOT NULL, months integer NOT NULL CHECK(months BETWEEN 1 AND 60),
 due_day integer NOT NULL CHECK(due_day BETWEEN 1 AND 31), category text NOT NULL,
 adjustment_note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS obligations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), contract_id uuid,
 description text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount > 0),
 due_date date NOT NULL, kind text NOT NULL CHECK(kind IN ('income','expense')),
 category text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','cancelled')),
 settled_transaction_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(contract_id,user_id) REFERENCES contracts(id,user_id),
 FOREIGN KEY(settled_transaction_id,user_id) REFERENCES transactions(id,user_id),
 UNIQUE(contract_id,due_date), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS import_batches (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), account_id uuid NOT NULL,
 filename text NOT NULL, file_hash text NOT NULL, format text NOT NULL,
 status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','committed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS import_candidates (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), batch_id uuid NOT NULL,
 date date NOT NULL, description text NOT NULL, amount numeric(18,2) NOT NULL CHECK(amount > 0),
 kind text NOT NULL CHECK(kind IN ('income','expense')), fingerprint text NOT NULL,
 category text NOT NULL DEFAULT 'Sem categoria', bank_id text,
 FOREIGN KEY(batch_id,user_id) REFERENCES import_batches(id,user_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
 entity_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_owner_date ON transactions(user_id,date);
CREATE INDEX IF NOT EXISTS obligations_owner_due ON obligations(user_id,due_date);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
-- Defesa adicional em PostgreSQL dedicado. O serviço deve utilizar um papel sem BYPASSRLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounts','transactions','contracts','obligations','import_batches','import_candidates','audit_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='owner_access') THEN
   EXECUTE format('CREATE POLICY owner_access ON %I USING (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
