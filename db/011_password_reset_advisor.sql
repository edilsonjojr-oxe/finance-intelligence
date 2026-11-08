-- Recuperação de senha por e-mail e Consultor IA. Somente aditiva.

-- Link de redefinição: guarda só o hash do token; uso único; expira em 30 minutos.
CREATE TABLE IF NOT EXISTS password_resets (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id, created_at);

-- Consultor IA: consentimento explícito por usuário e limite diário de uso.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_consent_at timestamptz;
CREATE TABLE IF NOT EXISTS ai_usage (
 user_id uuid NOT NULL REFERENCES users(id),
 day date NOT NULL,
 questions integer NOT NULL DEFAULT 0 CHECK (questions >= 0),
 input_tokens bigint NOT NULL DEFAULT 0,
 output_tokens bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, day)
);

DO $$ BEGIN
  ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE password_resets FORCE ROW LEVEL SECURITY;
  ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_usage' AND policyname = 'owner_access') THEN
    CREATE POLICY owner_access ON ai_usage
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
  END IF;
  -- Redefinição acontece sem sessão (como convites): só o papel restrito do app acessa.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    GRANT SELECT, INSERT, UPDATE ON password_resets TO finance_app;
    GRANT SELECT, INSERT, UPDATE ON ai_usage TO finance_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'password_resets' AND policyname = 'app_access') THEN
      CREATE POLICY app_access ON password_resets TO finance_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON password_resets FROM anon, authenticated;
    REVOKE ALL ON ai_usage FROM anon, authenticated;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES(11);
