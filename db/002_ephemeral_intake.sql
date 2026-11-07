-- Migração aditiva: não altera lançamentos, saldos ou contratos existentes.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'service';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS total_amount numeric(18,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewal_date date;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS interest_rate numeric(12,6);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS cet numeric(12,6);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS rate_period text NOT NULL DEFAULT 'monthly';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS cet_period text NOT NULL DEFAULT 'annual';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS penalty_note text NOT NULL DEFAULT '';
ALTER TABLE obligations ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'predicted' CHECK(stage IN ('predicted','charged','estimated'));
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_status_check CHECK(status IN ('review','committed','discarded','expired'));
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours');
ALTER TABLE import_candidates ADD COLUMN IF NOT EXISTS obligation_id uuid;
ALTER TABLE import_candidates ADD CONSTRAINT candidate_obligation_owner FOREIGN KEY(obligation_id,user_id) REFERENCES obligations(id,user_id);
CREATE TABLE IF NOT EXISTS source_events (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 source_type text NOT NULL CHECK(source_type IN ('document','email','conversation','manual','csv','ofx')),
 fingerprint text NOT NULL, source_hash text NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('predicted','charged','paid','estimated','contract')),
 obligation_id uuid, transaction_id uuid, contract_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(obligation_id,user_id) REFERENCES obligations(id,user_id),
 FOREIGN KEY(transaction_id,user_id) REFERENCES transactions(id,user_id),
 FOREIGN KEY(contract_id,user_id) REFERENCES contracts(id,user_id),
 UNIQUE(user_id,fingerprint)
);
ALTER TABLE source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_events FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_access ON source_events USING (user_id = nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id',true),'')::uuid);
CREATE INDEX source_events_owner ON source_events(user_id,obligation_id);
INSERT INTO schema_migrations(version) VALUES(2);
