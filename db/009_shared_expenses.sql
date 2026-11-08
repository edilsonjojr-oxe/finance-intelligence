-- Despesas compartilhadas (Etapa 1): conexões, grupos, despesas divididas, partes, acertos e o
-- vínculo de cada parte com o ledger do próprio usuário. Modelo já preparado para a Etapa 2
-- (tipo/status do grupo, membro sem usuário via display_name).
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('checking','savings','cash','investment','credit_card','receivable'));

CREATE TABLE IF NOT EXISTS connections (
 id uuid PRIMARY KEY,
 requester_id uuid NOT NULL REFERENCES users(id),
 addressee_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','blocked')),
 blocked_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 responded_at timestamptz,
 CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_pair ON connections (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

CREATE TABLE IF NOT EXISTS share_groups (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
 kind text NOT NULL DEFAULT 'home' CHECK (kind IN ('home','trip','event','other')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS share_members (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES share_groups(id),
 user_id uuid REFERENCES users(id),
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
 role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
 auto_post boolean NOT NULL DEFAULT false,
 auto_account_id uuid,
 removed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS share_members_user ON share_members (group_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared_expenses (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES share_groups(id),
 created_by uuid NOT NULL REFERENCES users(id),
 payer_member_id uuid NOT NULL REFERENCES share_members(id),
 description text NOT NULL CHECK (length(description) BETWEEN 1 AND 160),
 total numeric(18,2) NOT NULL CHECK (total > 0),
 date date NOT NULL,
 category text NOT NULL,
 split_mode text NOT NULL CHECK (split_mode IN ('equal','selected','exact','percent')),
 source_hash text,
 version integer NOT NULL DEFAULT 1,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shared_shares (
 id uuid PRIMARY KEY,
 expense_id uuid NOT NULL REFERENCES shared_expenses(id),
 group_id uuid NOT NULL REFERENCES share_groups(id),
 member_id uuid NOT NULL REFERENCES share_members(id),
 amount numeric(18,2) NOT NULL CHECK (amount >= 0),
 UNIQUE (expense_id, member_id)
);
CREATE TABLE IF NOT EXISTS shared_settlements (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES share_groups(id),
 from_member_id uuid NOT NULL REFERENCES share_members(id),
 to_member_id uuid NOT NULL REFERENCES share_members(id),
 amount numeric(18,2) NOT NULL CHECK (amount > 0),
 date date NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
 created_by uuid NOT NULL REFERENCES users(id),
 confirmed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (from_member_id <> to_member_id)
);
-- Vínculo da parte com o ledger do PRÓPRIO usuário (RLS por dono): o que já foi lançado.
CREATE TABLE IF NOT EXISTS shared_postings (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 expense_id uuid REFERENCES shared_expenses(id),
 settlement_id uuid REFERENCES shared_settlements(id),
 role text NOT NULL CHECK (role IN ('payer','participant','settle_paid','settle_received')),
 version integer NOT NULL DEFAULT 1,
 transaction_id uuid,
 transfer_id uuid,
 obligation_id uuid,
 notice text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shared_postings_once ON shared_postings (user_id, expense_id, role) WHERE expense_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shared_postings_settle ON shared_postings (user_id, settlement_id, role) WHERE settlement_id IS NOT NULL;

-- Associação ao grupo, sem recursão de RLS (lê share_members com privilégio do dono da função).
CREATE OR REPLACE FUNCTION fi_is_member(g uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.share_members m
    WHERE m.group_id = g AND m.removed_at IS NULL
      AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid);
$$;
REVOKE ALL ON FUNCTION fi_is_member(uuid) FROM PUBLIC;

DO $$
DECLARE me text := 'nullif(current_setting(''app.user_id'',true),'''')::uuid';
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connections','share_groups','share_members','shared_expenses','shared_shares','shared_settlements','shared_postings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='connections' AND policyname='party_access') THEN
    EXECUTE format('CREATE POLICY party_access ON connections USING (requester_id = %1$s OR addressee_id = %1$s) WITH CHECK (requester_id = %1$s OR addressee_id = %1$s)', me);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='share_groups' AND policyname='member_access') THEN
    EXECUTE format('CREATE POLICY member_access ON share_groups USING (fi_is_member(id) OR created_by = %1$s) WITH CHECK (created_by = %1$s OR fi_is_member(id))', me);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='share_members' AND policyname='member_access') THEN
    EXECUTE format('CREATE POLICY member_access ON share_members USING (fi_is_member(group_id) OR user_id = %1$s) WITH CHECK (fi_is_member(group_id) OR EXISTS (SELECT 1 FROM share_groups g WHERE g.id = group_id AND g.created_by = %1$s))', me);
  END IF;
  FOREACH t IN ARRAY ARRAY['shared_expenses','shared_shares','shared_settlements'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='member_access') THEN
      EXECUTE format('CREATE POLICY member_access ON %I USING (fi_is_member(group_id)) WITH CHECK (fi_is_member(group_id))', t);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shared_postings' AND policyname='owner_access') THEN
    EXECUTE format('CREATE POLICY owner_access ON shared_postings USING (user_id = %1$s) WITH CHECK (user_id = %1$s)', me);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    GRANT SELECT, INSERT, UPDATE ON connections, share_groups, share_members, shared_expenses, shared_shares, shared_settlements, shared_postings TO finance_app;
    GRANT DELETE ON shared_shares TO finance_app;
    GRANT EXECUTE ON FUNCTION fi_is_member(uuid) TO finance_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON connections, share_groups, share_members, shared_expenses, shared_shares, shared_settlements, shared_postings FROM anon, authenticated;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES(9);
