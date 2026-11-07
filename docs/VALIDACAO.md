# Evidências da entrega 0.1

Validação executada durante a implementação, em 5 de novembro de 2026 (America/Sao_Paulo).

- TypeScript: sem erros.
- Regras unitárias: 13 testes aprovados, incluindo centavos, rateio, fim de mês, transferências, previsão e parsers.
- Integração: 12 cenários aprovados, incluindo rollback de lote, duplicidades, vínculo com pagamento existente, RLS com papel restrito, auditoria e persistência após fechar e reabrir o banco.
- HTTP: acesso sem sessão negado, origem não autorizada negada, sessão HttpOnly/SameSite, criação de registros, exportação CSV com proteção contra fórmula e revogação no logout.
- Navegador: login, indicadores calculados, cadastro de conta, cadastro e liquidação de compromisso; validação visual desktop e viewport móvel de 390 × 844. Sem erros de console observados ao final desses fluxos.
- O teste no navegador identificou e levou à correção do envio de `name: null` no login de perfil existente.

Todas as movimentações de teste são sintéticas, em `.data/test-<UUID>` ou `.data/ui-verification`. A base pessoal `.data/finance` começa sem perfil e sem movimentações.

Não verificados nesta entrega: PostgreSQL remoto, MFA, conectores, IA, cartões, dívidas, PDF/OCR, restauração de backup, carga de 10 mil lançamentos, metas de disponibilidade e segurança de uma implantação pública. A cobertura de testes não representa aprovação de toda a especificação V1.

## Correção de origem no cadastro — 6 de novembro de 2026

Reproduzido no servidor otimizado: o navegador enviava `Origin: http://127.0.0.1:3000`, mas a URL interna do Next.js usava `localhost`. Sem `APP_ORIGIN`, a comparação literal recusava o cadastro com HTTP 403.

A validação agora reconhece exclusivamente `localhost`, `127.0.0.1` e `[::1]` como endereços locais, exigindo o mesmo protocolo e porta. `APP_ORIGIN` configurada continua exigindo a origem exata. Cabeçalhos `Host` e `X-Forwarded-*` não ampliam as origens autorizadas; origens ausentes, inválidas ou externas continuam bloqueadas. Há nove testes de regressão específicos para essa regra.

Resultado: 22 testes unitários aprovados, TypeScript e build sem erros. Cadastro completo, sessão e gravação validados por HTTP em um servidor otimizado separado, sem `APP_ORIGIN`, usando a base sintética `.data/origin-regression`. No servidor pessoal, a requisição local passou pela checagem de origem, a origem externa continuou recebendo 403 e o perfil permaneceu sem cadastro, aguardando o usuário.

## Atualização 0.2 — 7 de novembro de 2026

Executados: TypeScript; 29 testes unitários; os 12 cenários de integração existentes; 8 novos cenários de migração aditiva, conciliação entre fontes, rollback, isolamento/RLS, descarte, expiração, backup autenticado e restauração em base vazia; leitura de PDF real sintético, TXT, limites de arquivo e OCR de PNG sintético com modelo português; build de produção; suíte HTTP em servidor loopback com base sintética separada.

Backup com senha incorreta e conteúdo adulterado foi rejeitado. A restauração preservou quantidades e vínculos e recusou destino não vazio. Os testes não usam documentos pessoais.

A validação visual nova foi interrompida pela ferramenta de controle do computador, que não conseguiu identificar a URL da janela com segurança. A execução de OCR/PDF foi validada por código, não de ponta a ponta na interface móvel. PostgreSQL remoto, publicação, restauração remota, Gmail e IA continuam não validados. Resultados históricos da 0.1 acima não certificam as novas telas.
