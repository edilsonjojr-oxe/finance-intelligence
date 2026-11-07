import { readFile } from 'node:fs/promises';
import path from 'node:path';
export const migrations = ['001_foundation.sql','002_ephemeral_intake.sql','003_supabase_identity.sql','004_invites.sql','005_cards_categories.sql','006_transaction_splits.sql','007_loans_spreadsheets.sql'] as const;
export async function migrationSQL(index:number) {
  return readFile(path.join(process.cwd(),'db',migrations[index]),'utf8');
}
