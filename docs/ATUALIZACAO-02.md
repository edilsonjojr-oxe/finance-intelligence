# Diagnóstico e atualização incremental 0.2

## Diagnóstico e decisões

| Área | Estado anterior | Alteração |
|---|---|---|
| Interface Next.js/React | Funcional, visual verde/creme responsivo | Componentes preservados; revisão de fontes e backup adicionados |
| Contas, caixa, contratos e projeção | Regras reais, persistência PGlite/PG | Preservadas; condições contratuais e distinção estimado/confirmado |
| CSV/OFX | Revisão sem edição e sem expiração | Correção, vínculo, descarte e expiração de candidatos |
| PDF/imagem/conversa | Não implementado | Leitura em memória, OCR local e revisão explícita |
| Conciliação | Vínculo integral de obrigação/pagamento | Evidências de múltiplas fontes e idempotência |
| Banco | Esquema inicial | Migração aditiva 002; migrações pendentes aplicadas uma vez |
| Backup | Não implementado | Exportação criptografada e restauração em base separada |
| Gmail e consultor IA | Planejados | Permanecem explicitamente desabilitados/planejados |

A sequência aplicada foi diagnosticar, preservar os módulos reais, acrescentar uma migração, implementar leitores e confirmação atômica, conectar a interface e testar com bases sintéticas. Não foram apagados registros pessoais nem reconstruído o projeto.

## Hospedagem

A documentação de [Sites](https://learn.chatgpt.com/docs/sites) restringe o processamento de dados de cartão ao processador de pagamentos e descreve limitações de rede/runtime. Isso não equivale a proibir todos os dados financeiros, mas não fundamenta hospedar este sistema sensível sem avaliação adicional. A arquitetura existente usa Node e conexão PostgreSQL, diferente do ambiente Workers/D1 de Sites. Mantivemos ChatGPT como ambiente de desenvolvimento.

A alternativa mínima preparada é um serviço Node e um PostgreSQL gerenciado, sem armazenamento de documentos. [Render suporta Next.js](https://render.com/docs/deploy-nextjs-app) e [backups PostgreSQL em planos pagos](https://render.com/docs/postgresql-backups). O arquivo de proposta segue os campos da [referência Blueprint](https://render.com/docs/blueprint-spec); não foi submetido ao provedor e não representa implantação concluída ou preço contratado.

O usuário também informou GitHub e Supabase conectados. GitHub foi verificado pelo CLI autenticado; a descoberta confirmou ambos os plugins instalados. Entretanto, ferramentas operacionais do Supabase não foram disponibilizadas nesta sessão. Nenhum projeto remoto foi criado ou alterado.

Supabase pode substituir o PostgreSQL da proposta usando [conexão PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), sem adicionar banco paralelo. Antes de migrar: escolher projeto dedicado, verificar esquema existente e backups, aplicar migrações com credencial administrativa, criar papel de execução restrito e testar transações/RLS. Não aplicar o esquema cegamente a um projeto compartilhado.

As tabelas atuais de autenticação são próprias da aplicação. Para Supabase, é obrigatório impedir sua exposição pela Data API: preferir esquema privado ou revogar explicitamente acessos dos papéis anon/authenticated, incluindo privilégios padrão; validar as políticas conforme [segurança da API](https://supabase.com/docs/guides/api/securing-your-api). Essa preparação remota ainda não foi executada. Não usar service_role no navegador.

## Preparação operacional

- DATABASE_MIGRATION_URL somente no terminal administrativo para `npm run db:migrate`.
- DATABASE_URL no servidor, papel sem superusuário/BYPASSRLS/DDL. O modo cloud recusa privilégios elevados básicos.
- APP_ORIGIN com a origem HTTPS exata; SETUP_TOKEN aleatório com pelo menos 32 caracteres protege o primeiro cadastro.
- `npm run start:cloud` exige PostgreSQL, HTTPS e token; ativa cookie Secure e escuta a porta fornecida pelo provedor.
- Configurar e ensaiar backup/restauração no provedor, retenção e recuperação. Não capturar corpo de requisições em logs/APM.
- Transferência dos dados locais deve preservar IDs e vínculos; não existe sincronização local/nuvem implementada.

## Arquivos principais afetados

`db/002_ephemeral_intake.sql`; `src/server/{migrations,db,finance-service,intake,backup,auth,connectors}.ts`; `src/lib/{intake,document-extraction,document-reader,finance,types}.ts`; `src/components/{finance-app,source-intake,candidate-editor,backup-panel}.tsx`; rotas `api/auth`, `api/backup`, `api/health`; estilos/layout; scripts de leitores, migração, restauração e inicialização cloud; package/lock; testes e documentação.

## Limites

Extração por regras é revisável e não universal. Não há conciliação parcial/muitos-para-muitos, cronograma de amortização automático, OAuth Gmail nem LLM. O descarte lógico não promete exclusão física de mídias ou backups de terceiros. A validação visual desta atualização foi bloqueada pelo controle do computador por não identificar a URL com segurança; não se afirma teste visual completo em celular ou navegador.
