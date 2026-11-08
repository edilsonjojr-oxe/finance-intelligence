# Fila de execução (sequencial, sem pausas para aprovação)

Combinado com o usuário em 7 nov 2026: implementar na ordem abaixo, com commit e publicação ao
final de cada bloco, sem perguntar entre etapas. Ao retomar uma sessão, continuar do primeiro
item não marcado. Migrações em produção só acrescentam estrutura (nunca apagam dados).

Legenda: [x] feito · [ ] pendente · [-] fora do escopo por decisão do usuário

## Ações do usuário
- [x] APP_ORIGIN na Vercel corrigido
- [x] Enforce SSL no Supabase
- [x] Instalação testada no iPhone e Android
- [ ] Marcar "Já paga" nas parcelas antigas importadas (usuário fará)

## 1. Sessão e segurança
- [x] 1.1 Sessão deslizante: renova a cada uso; expira com 7 dias sem uso ou 30 dias no total
- [x] 1.2 "Sair de todos os aparelhos" em Configurações
- [-] 1.3 MFA/2FA — removido pelo usuário
- [x] 1.4 Recuperar senha — pendente de serviço de e-mail (só registrar no ROADMAP)

## 2. Telas mais enxutas
- [x] 2.1 Textos de ajuda curtos; explicações em "Saiba mais" (Importações, fatura, planilha, Empréstimos)
- [x] 2.2 Planilha: resumo primeiro, detalhe por aba recolhido
- [x] 2.3 Revisão mobile: rolagem lateral corrigida (.sr-only do cabeçalho sem âncora); todas as páginas em 375px

## 3. Cartões completos (Fase D)
- [x] 3.1 Fechamento: compras após o fechamento vão para a próxima fatura; fatura atual × próxima
- [x] 3.2 "PARC 03/10" gera as parcelas futuras como previstas
- [x] 3.3 Limite disponível e alerta
- [x] 3.4 Conferência total lido × lançamentos (na leitura da fatura)

## 4. Nota de mercado (Fase C)
- [x] 4.1 Ler cupom (foto/PDF/texto) em itens
- [x] 4.2 Categoria por produto + memória
- [x] 4.3 Vincular à compra e dividir automaticamente (descontos rateados, soma = total)
- [-] 4.4 Chave/QR NFC-e SEFAZ-RS — não será feito (decisão do usuário)

## 5. Orçamentos e metas (Fase E)
- [x] 5.1 Limite mensal por grupo/subcategoria com alerta
- [x] 5.2 Metas de economia/reserva

## 6. Relatórios (Fase F)
- [x] 6.1 Mês a mês por categoria, evolução
- [x] 6.2 Maiores estabelecimentos
- [x] 6.3 Exportar CSV/Excel com partes divididas

## 7. Despesas compartilhadas (Etapa 1)
Modelo contábil adotado: pagador vê saída de caixa total, despesa só da própria parte e o resto
"a receber" (fora dos relatórios de gasto); participante recebe a parte como compromisso "a pagar
para Fulano", que vira despesa ao quitar; reembolso não é receita. Materialização só no ledger do
próprio usuário (caixa "Para lançar" ou automático por grupo). RLS por membro, sem BYPASSRLS.
- [x] 7.1 Conexões (pedido/aceite/recusa/remoção/bloqueio, resposta neutra)
- [x] 7.2 Grupo permanente 2+ membros (modelo pronto para Etapa 2)
- [x] 7.3 Despesa dividida: igual, selecionados, exatos, % (centavos determinísticos, zod no servidor)
- [x] 7.4 Ler comprovante reaproveitando o leitor
- [x] 7.5 Materialização sem dupla contagem
- [x] 7.6 Acerto entre membros + saldo líquido por pessoa
- [x] 7.7 Edição/exclusão lógica com ajustes e auditoria
- [x] 7.8 Testes: conexão, RLS de terceiro, modos, arredondamento, soma ≠ total, materialização, acerto, edição/exclusão

> Bloco 7 publicado em 2026-11-08 (migração 009 aplicada no Supabase, deploy ok).

## 8. Grupos de divisão (Etapa 2)
Decisões padrão: upgrade de "só divisão" para completa apenas por convite normal de usuário
completo; membro sem conta (só nome) incluído, vinculável depois.
- [x] 8.1 Tipos/período/status; encerrar trava lançamentos
- [x] 8.2 Link de convite (hash, validade, usos, revogação, compartilhar)
- [x] 8.3 Conta split_only bloqueada no servidor fora do módulo; limites anti-abuso
- [x] 8.4 Membro sem conta
- [x] 8.5 Saldos, simplificar dívidas, acerto confirmado
- [x] 8.6 Materialização opcional para conta completa
- [x] 8.7 Feed de atividade e CSV de encerramento

> Bloco 8 publicado em 2026-11-08 (migração 010 aplicada no Supabase). Testes: npm run test:split.

## 9. Testes e qualidade (contínuo)
- [ ] 9.1 http-run com as novas funcionalidades
- [x] 9.2 Fluxos principais na tela (desktop e celular) — revisão de interface 2026-11-08
- [ ] 9.3 Restauração de backup com tabelas novas

## 10. Revisão de interface (2026-11-08)
- [x] Menu agrupado (principal / Planejamento / Pessoas) e barra inferior no celular com "Mais"
- [x] Endereço por tela (#/movimentacoes etc.); botão voltar funciona
- [x] Um único "Exportar" (Movimentações: período + filtros); Relatórios sem exportação duplicada
- [x] Importar em abas (documento, planilha, extrato, nota); revisão de extrato preservada
- [x] Textos curtos; painéis decorativos e roadmap desatualizado removidos
- [x] Paleta quente, fontes maiores, tabela de movimentações em lista no celular
- [x] Duplo clique não repete lançamento (requisição idêntica em andamento é reaproveitada)

## 11. Próximas (decisão do usuário em 2026-11-08)
- [x] 11.1 Recuperar senha por e-mail (link de uso único, expira em 30 min, encerra sessões)
- [x] 11.2 Consultor IA: perguntas e simulações sobre os dados, cálculos feitos pelo app, nada gravado sem confirmação
- [-] Gmail (faturas por e-mail) — não será feito, decisão do usuário
- [-] Consulta NFC-e SEFAZ-RS — não será feito, decisão do usuário

> Bloco 11 pronto em 2026-11-08: migração 011 (aguardando aplicação no Supabase). Testes: npm run test:reset, npm run test:advisor.
> Configurar na Vercel: ANTHROPIC_API_KEY (consultor) e SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM (e-mail).
