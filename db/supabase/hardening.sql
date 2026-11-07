-- Blindagem específica do Supabase. Executar com o papel postgres APÓS db/001..003.
-- Não faz parte das migrações locais (PGlite). A senha do papel é definida à parte
-- (ver ALTER ROLE no final), nunca versionada.

-- 1) Data API (PostgREST) não deve enxergar nenhuma tabela deste app.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 2) Papel de execução do app: sem superusuário, sem BYPASSRLS, sem DDL.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    CREATE ROLE finance_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO finance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, login_attempts, accounts, transactions,
  contracts, obligations, import_batches, import_candidates, source_events TO finance_app;
GRANT SELECT, INSERT ON audit_events TO finance_app;
GRANT SELECT ON schema_migrations TO finance_app;

-- 3) Tabelas sem dono financeiro também com RLS: só o papel do app as acessa.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','login_attempts','schema_migrations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'app_access') THEN
      EXECUTE format('CREATE POLICY app_access ON %I TO finance_app USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;
ALTER FUNCTION prevent_audit_mutation() SET search_path = '';

-- 4) Senha do papel: gere localmente e envie só o verificador SCRAM, por exemplo
--    ALTER ROLE finance_app PASSWORD 'SCRAM-SHA-256$4096:<salt>$<stored>:<server>';
--    A senha em texto fica apenas em .env.local / variáveis da hospedagem.
