-- Orçamentos mensais por categoria (grupo ou "Grupo / Subcategoria") e metas de economia.
CREATE TABLE IF NOT EXISTS budgets (
 user_id uuid NOT NULL REFERENCES users(id),
 category text NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
 amount numeric(18,2) NOT NULL CHECK (amount > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, category)
);
CREATE TABLE IF NOT EXISTS goals (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 target numeric(18,2) NOT NULL CHECK (target > 0),
 saved numeric(18,2) NOT NULL DEFAULT 0 CHECK (saved >= 0),
 deadline date,
 account_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['budgets','goals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'owner_access') THEN
      EXECUTE format('CREATE POLICY owner_access ON %I USING (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid)', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO finance_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
INSERT INTO schema_migrations(version) VALUES(8);
