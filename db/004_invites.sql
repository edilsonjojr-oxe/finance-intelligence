-- Convites de uso único para novos usuários. Guarda só o hash do código.
CREATE TABLE IF NOT EXISTS invites (
 code_hash text PRIMARY KEY,
 created_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 used_by uuid REFERENCES users(id),
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((used_by IS NULL) = (used_at IS NULL))
);
CREATE INDEX IF NOT EXISTS invites_creator ON invites(created_by, created_at);
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites FORCE ROW LEVEL SECURITY;
-- No Supabase: só o papel restrito do app acessa; Data API (anon/authenticated) não.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    GRANT SELECT, INSERT, UPDATE ON invites TO finance_app;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'invites' AND policyname = 'app_access') THEN
      CREATE POLICY app_access ON invites TO finance_app USING (true) WITH CHECK (true);
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON invites FROM anon, authenticated;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES(4);
