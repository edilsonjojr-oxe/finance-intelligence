-- Vincula uma identidade externa sem alterar IDs/propriedade dos dados financeiros.
ALTER TABLE users ADD COLUMN supabase_subject uuid;
ALTER TABLE users ADD COLUMN supabase_issuer text;
ALTER TABLE users ADD CONSTRAINT users_supabase_identity_pair CHECK ((supabase_subject IS NULL) = (supabase_issuer IS NULL));
CREATE UNIQUE INDEX users_supabase_identity ON users(supabase_issuer,supabase_subject) WHERE supabase_subject IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES(3);
