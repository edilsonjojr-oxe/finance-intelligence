# Roadmap após a atualização 0.2

Preservar a aplicação existente. Documentos originais não terão biblioteca permanente.

1. Concluir validação visual dos novos formulários e leitores no navegador e em celular; ampliar parsers por emissor sem aceitar valores incertos automaticamente.
2. Validar PostgreSQL remoto com papel restrito, backups e restauração; escolher hospedagem Node e conectar repositório privado. GitHub/Supabase não substituem a hospedagem da aplicação.
3. Cartões, compras, parcelamentos e faturas sem contabilizar pagamento duas vezes; pagamentos parciais e conciliação muitos-para-muitos.
4. Dívidas, cronogramas e comparação de renegociação com cálculos verificáveis.
5. Orçamentos, metas e patrimônio; edição auditada e aditivos contratuais.
6. MFA, recuperação de acesso e testes operacionais de carga/disponibilidade.
7. Gmail com OAuth próprio, consentimento mínimo, revogação e extração transitória. Nenhuma conexão simulada.
8. Consultor IA com ferramentas de leitura sobre dados estruturados, cálculos determinísticos e propostas sujeitas à confirmação. Separar realizados, previstos e estimados.

Nenhuma dessas evoluções é apresentada como concluída. A versão 0.2 já acrescenta leitura temporária de documentos, revisão, conciliação de evidências, condições contratuais e backup criptografado; as evidências estão em VALIDACAO.md.
