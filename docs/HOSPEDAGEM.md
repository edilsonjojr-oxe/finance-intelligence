# Hospedagem: Vercel + Supabase

Decisão (7 nov 2026): app na Vercel (plano Hobby, gratuito), banco no PostgreSQL do Supabase,
login próprio do app (não Supabase Auth). A base local será copiada no momento da troca.

## Estado do Supabase

- Projeto `Finance Intelligence` (ref `pafegzsrtocggmxqrpqh`, São Paulo, plano gratuito).
- Esquema `db/001`–`003` aplicado; blindagem `db/supabase/hardening.sql` aplicada.
- Data API (chave publicável) não lê nenhuma tabela: privilégios de `anon`/`authenticated`
  revogados e RLS em todas as tabelas. Verificado: HTTP 401 em `/rest/v1/*`. Linter de
  segurança do Supabase sem alertas.
- O app conecta como `finance_app` (sem superusuário, sem BYPASSRLS, sem DDL), pelo pooler
  em modo transação: `aws-1-sa-east-1.pooler.supabase.com:6543`, usuário
  `finance_app.pafegzsrtocggmxqrpqh`. A senha fica só em `.env.supabase` (não versionado) e nas
  variáveis da Vercel. Para trocá-la, envie apenas o verificador SCRAM (ver hardening.sql).
- Testado com dados sintéticos (cadastro, conta, layout de celular, cópia completa de
  perfil) e limpo em seguida.

## Em produção desde 7 nov 2026

- Site: https://finance-intelligence-8onn.vercel.app (deploy automático a cada push em `main`).
- Base pessoal copiada do PC para o Supabase nesta data (contagens conferidas). A pasta
  `.data/finance` ficou como histórico e não deve mais receber lançamentos; cópia de
  segurança em `backups/finance-antes-da-nuvem-*` (fora do git).
- O servidor local da porta 3000 foi desligado para evitar duas bases divergentes.

## Desenvolvimento contra o Supabase

`node scripts/dev-supabase.mjs` (ou a configuração `dev-supabase` em `.claude/launch.json`)
sobe `next dev` na porta 3003 lendo `.env.supabase`. Não use `.env.local` para isso: o Next o
carregaria também no servidor pessoal.

## Troca para a nuvem (ordem)

1. Repositório privado no GitHub e push do código.
2. Projeto na Vercel importando o repositório, com as variáveis:
   `DATABASE_URL` (de `.env.supabase`), `DATABASE_CA_CERT` (PEM baixado do Supabase),
   `APP_ORIGIN` (URL https definitiva da Vercel), `NEXT_TELEMETRY_DISABLED=1`.
   `SETUP_TOKEN` só é necessário se o perfil não for copiado.
3. Parar o servidor pessoal (porta 3000) e gerar um backup `.fib` antes.
4. `npx tsx scripts/copy-to-postgres.ts .data/finance` (simulação) e depois com `--apply`.
   O script recusa destino não vazio e confere as contagens por tabela.
5. Entrar pelo endereço da Vercel no computador e no celular.
6. A partir daí a base local deixa de ser usada (não há sincronização entre as duas).

## Limites

- Plano Hobby da Vercel é para uso pessoal/não comercial; funções têm limite de duração.
- Backups automáticos do Supabase gratuito são limitados; mantenha backups `.fib` manuais.
- Sem recuperação de senha por e-mail nem MFA (roadmap).
