-- Grupos de divisão (Etapa 2): período e encerramento do grupo, convite por link, conta
-- "só divisão", membro sem conta e grupo que não lança no financeiro. Somente aditiva.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'full';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_plan_check CHECK (plan IN ('full','split_only'));
  END IF;
END $$;
ALTER TABLE share_groups ADD COLUMN IF NOT EXISTS starts_on date;
ALTER TABLE share_groups ADD COLUMN IF NOT EXISTS ends_on date;
ALTER TABLE share_groups ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE share_members ADD COLUMN IF NOT EXISTS skip_ledger boolean NOT NULL DEFAULT false;

-- Link de convite: guarda só o hash do token; validade, limite de usos e revogação.
CREATE TABLE IF NOT EXISTS share_invites (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES share_groups(id),
 token_hash text NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 50),
 uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_invites_group ON share_invites(group_id, created_at);

-- Prévia do convite para quem ainda não é membro (nem tem conta). Só devolve algo com token válido.
CREATE OR REPLACE FUNCTION fi_invite_preview(p_hash text)
RETURNS TABLE(group_name text, kind text, inviter text, guests jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT g.name, g.kind, u.name,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'name', m.display_name) ORDER BY m.created_at)
      FROM public.share_members m WHERE m.group_id = g.id AND m.user_id IS NULL AND m.removed_at IS NULL), '[]'::jsonb)
  FROM public.share_invites i
  JOIN public.share_groups g ON g.id = i.group_id
  JOIN public.users u ON u.id = i.created_by
  WHERE i.token_hash = p_hash AND i.revoked_at IS NULL AND i.expires_at > now()
    AND i.uses < i.max_uses AND g.status = 'active';
$$;
REVOKE ALL ON FUNCTION fi_invite_preview(text) FROM PUBLIC;

-- Entrada no grupo pelo link, como o usuário da sessão (app.user_id). Opcionalmente assume um
-- membro sem conta (mesmo grupo, ainda não vinculado). Devolve o grupo ou NULL se inválido.
CREATE OR REPLACE FUNCTION fi_join_by_invite(p_hash text, p_claim uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  inv public.share_invites%ROWTYPE;
  existing uuid;
  nm text;
BEGIN
  IF me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO inv FROM public.share_invites WHERE token_hash = p_hash FOR UPDATE;
  IF NOT FOUND OR inv.revoked_at IS NOT NULL OR inv.expires_at <= now() OR inv.uses >= inv.max_uses THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.share_groups WHERE id = inv.group_id AND status = 'active') THEN RETURN NULL; END IF;
  SELECT id INTO existing FROM public.share_members WHERE group_id = inv.group_id AND user_id = me;
  IF existing IS NOT NULL THEN
    UPDATE public.share_members SET removed_at = NULL WHERE id = existing;
    RETURN inv.group_id;
  END IF;
  IF (SELECT count(*) FROM public.share_members WHERE group_id = inv.group_id AND removed_at IS NULL) >= 50 THEN RETURN NULL; END IF;
  SELECT name INTO nm FROM public.users WHERE id = me;
  IF p_claim IS NOT NULL AND EXISTS (SELECT 1 FROM public.share_members
       WHERE id = p_claim AND group_id = inv.group_id AND user_id IS NULL AND removed_at IS NULL) THEN
    UPDATE public.share_members SET user_id = me WHERE id = p_claim;
  ELSE
    INSERT INTO public.share_members(id, group_id, user_id, display_name)
      VALUES (gen_random_uuid(), inv.group_id, me, coalesce(nullif(left(nm, 80), ''), 'Membro'));
  END IF;
  UPDATE public.share_invites SET uses = uses + 1 WHERE id = inv.id;
  RETURN inv.group_id;
END $$;
REVOKE ALL ON FUNCTION fi_join_by_invite(text, uuid) FROM PUBLIC;

DO $$ BEGIN
  ALTER TABLE share_invites ENABLE ROW LEVEL SECURITY;
  ALTER TABLE share_invites FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'share_invites' AND policyname = 'member_access') THEN
    CREATE POLICY member_access ON share_invites USING (fi_is_member(group_id)) WITH CHECK (fi_is_member(group_id));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_app') THEN
    GRANT SELECT, INSERT, UPDATE ON share_invites TO finance_app;
    GRANT EXECUTE ON FUNCTION fi_invite_preview(text) TO finance_app;
    GRANT EXECUTE ON FUNCTION fi_join_by_invite(text, uuid) TO finance_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON share_invites FROM anon, authenticated;
    REVOKE ALL ON FUNCTION fi_invite_preview(text) FROM anon, authenticated;
    REVOKE ALL ON FUNCTION fi_join_by_invite(text, uuid) FROM anon, authenticated;
  END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES(10);
