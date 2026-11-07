-- Empréstimos e acordos: direção (eu devo / me devem), até 360 parcelas, e planilhas como
-- origem de dados importados (para não duplicar ao reimportar).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'payable'
  CHECK (direction IN ('payable', 'receivable'));
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_months_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_months_check CHECK (months BETWEEN 1 AND 360);
ALTER TABLE source_events DROP CONSTRAINT IF EXISTS source_events_source_type_check;
ALTER TABLE source_events ADD CONSTRAINT source_events_source_type_check
  CHECK (source_type IN ('document','email','conversation','manual','csv','ofx','spreadsheet'));
INSERT INTO schema_migrations(version) VALUES(7);
