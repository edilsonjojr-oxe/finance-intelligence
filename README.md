# Finance Intelligence — versão 0.2

Atualização incremental da aplicação existente. A identidade visual, contas, lançamentos, contratos, compromissos, gráficos, projeção e auditoria foram preservados. Não é a implementação completa da especificação original.

## Executar

Use Node.js 24. Na pasta do projeto:

```powershell
npm ci
npm run build
npm start
```

Acesse http://127.0.0.1:3000. Sem DATABASE_URL, os registros persistem em `.data/finance`, mesmo após fechar o navegador. Execute somente um processo por diretório PGlite. O primeiro acesso cria o perfil pessoal; não há senha padrão. A proteção de origem reconhece localhost e 127.0.0.1 na mesma porta; APP_ORIGIN explícita exige correspondência exata.

## Documentos e conciliação

Em Importações, PDF com texto, PNG/JPEG (OCR em português), TXT e texto colado são lidos em memória no navegador. Os leitores e o modelo OCR são servidos pela própria aplicação. Revise descrição, valor, categoria, data e situação antes de confirmar. Campos ausentes precisam ser preenchidos. A extração usa regras conservadoras, não um consultor de IA. Limites: 8 MB, PDF de até 40 páginas, imagem de até 16 megapixels. PDFs digitalizados devem ser enviados como imagens; PDFs protegidos e layouts complexos podem não ser reconhecidos.

Somente dados estruturados confirmados e hashes de identificação seguem para o servidor nesse fluxo. Não há biblioteca de documentos, armazenamento de originais ou envio a provedores de IA. A aplicação libera referências e encerra leitores; isso não garante eliminação física de memória, arquivos na origem, caches do sistema operacional ou cópias sob responsabilidade de terceiros.

CSV/OFX continuam sendo processados temporariamente no servidor, até 2 MB e 2.000 registros. Candidatos estruturados ficam em revisão por até 24 horas; a limpeza acontece no próximo acesso. Confirmação ou descarte remove os candidatos imediatamente, preservando movimentos e histórico. É possível corrigir campos e vincular compromissos antes de confirmar. O conteúdo original não é persistido e novos nomes de arquivo são substituídos por rótulos genéricos.

Contrato, cobrança e pagamento podem ser vinculados à mesma obrigação. Repetições exatas são idempotentes; semelhanças exigem vínculo ou confirmação de que são distintas. Conciliação atual é integral, um pagamento por obrigação. Faturas de cartão com itens e total exigem revisão para não lançar ambos; o módulo próprio de cartões ainda está pendente.

Contratos guardam instituição, valor contratado, parcelas mensais, vigência, renovação, juros/CET com períodos separados, reajustes e multas. Até 60 vencimentos são gerados após confirmação. Juros e reajustes são condições registradas, não cálculos automáticos de amortização ou indexação. Projeções usam valores confirmados e excluem estimativas do cenário base.

## Backup

Em Configurações, baixe um `.fib` criptografado com AES-256-GCM e chave derivada por scrypt. Guarde a senha separadamente: não há recuperação. Inclui perfil/hash da senha, contas, movimentos, contratos, obrigações, metadados de fontes e auditoria. Não inclui sessões, documentos nem candidatos pendentes.

Restauração somente em uma NOVA base local vazia, nunca sobre `.data/finance`:

```powershell
# Defina FINANCE_BACKUP_PASSPHRASE no ambiente do terminal, sem publicar o segredo.
npm run backup:restore -- caminho/backup.fib .data/restauracao
```

O banco em uso não é criptografado pela aplicação. Proteja o disco e suas permissões. Backup exportado é manual; backups automáticos e retenção dependem da hospedagem.

## Nuvem e outros dispositivos

O servidor padrão atende apenas o próprio PC. Com o PC ligado, acesso pela mesma rede é possível mediante configuração explícita de endereço, HTTPS e firewall. Essa configuração ainda não foi ativada. HTTPS é necessário também para as APIs criptográficas do leitor de documentos em endereços de rede. Não exponha a porta diretamente à internet.

GitHub guarda código; Supabase pode fornecer PostgreSQL. Ainda é necessário um serviço que execute Next.js/Node para funcionar com o PC desligado. Não houve publicação, contratação ou transferência da base pessoal. O adaptador PostgreSQL externo existe, mas não foi validado contra um servidor remoto nesta atualização.

`render.yaml` é uma proposta alternativa com um serviço Node e um PostgreSQL, sem bucket, fila ou VPS. Se usar Supabase, não provisione o segundo banco do exemplo. Consulte [operação e diagnóstico](docs/ATUALIZACAO-02.md).

## Validação

```powershell
npm run typecheck
npm test
npm run test:integration
npm run test:intake
npm run test:documents
npm run build
npx tsx tests/http-run.ts
```

Todos os testes usam dados sintéticos em diretórios separados. Veja [evidências e limites](docs/VALIDACAO.md). Os documentos sintéticos de teste ficam em `artifacts`, fora do código a publicar.

## Funcionalidades ainda planejadas

Cartões/faturas consolidadas, dívidas e renegociação, orçamentos/metas, consultor IA e linguagem natural ampla, Gmail/OAuth, MFA e recuperação de acesso. Não foram removidas funcionalidades reais desses módulos: elas ainda não existiam. O conector Gmail permanece desabilitado e não reutiliza credenciais do ChatGPT. Veja [roadmap](docs/ROADMAP.md).
