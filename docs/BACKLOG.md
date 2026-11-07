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
- [ ] 2.1 Textos de ajuda curtos; explicações em "Saiba mais" (Importações, fatura, planilha, Empréstimos)
- [ ] 2.2 Planilha: resumo primeiro, detalhe por aba recolhido
- [ ] 2.3 Revisão mobile (espaçamentos, botões, tabelas com rolagem)

## 3. Cartões completos (Fase D)
- [ ] 3.1 Fechamento: compras após o fechamento vão para a próxima fatura; fatura atual × próxima
- [ ] 3.2 "PARC 03/10" gera as parcelas futuras como previstas
- [ ] 3.3 Limite disponível e alerta
- [ ] 3.4 Conferência total lido × lançamentos

## 4. Nota de mercado (Fase C)
- [ ] 4.1 Ler cupom (foto/PDF/texto) em itens
- [ ] 4.2 Categoria por produto + memória
- [ ] 4.3 Vincular à compra e dividir automaticamente (descontos rateados, soma = total)
- [ ] 4.4 Avaliar chave/QR NFC-e SEFAZ-RS

## 5. Orçamentos e metas (Fase E)
- [ ] 5.1 Limite mensal por grupo/subcategoria com alerta
- [ ] 5.2 Metas de economia/reserva

## 6. Relatórios (Fase F)
- [ ] 6.1 Mês a mês por categoria, evolução
- [ ] 6.2 Maiores estabelecimentos
- [ ] 6.3 Exportar CSV/Excel com partes divididas

## 7. Despesas compartilhadas (Etapa 1)
Modelo contábil adotado: pagador vê saída de caixa total, despesa só da própria parte e o resto
"a receber" (fora dos relatórios de gasto); participante recebe a parte como compromisso "a pagar
para Fulano", que vira despesa ao quitar; reembolso não é receita. Materialização só no ledger do
próprio usuário (caixa "Para lançar" ou automático por grupo). RLS por membro, sem BYPASSRLS.
- [ ] 7.1 Conexões (pedido/aceite/recusa/remoção/bloqueio, resposta neutra)
- [ ] 7.2 Grupo permanente 2+ membros (modelo pronto para Etapa 2)
- [ ] 7.3 Despesa dividida: igual, selecionados, exatos, % (centavos determinísticos, zod no servidor)
- [ ] 7.4 Ler comprovante reaproveitando o leitor
- [ ] 7.5 Materialização sem dupla contagem
- [ ] 7.6 Acerto entre membros + saldo líquido por pessoa
- [ ] 7.7 Edição/exclusão lógica com ajustes e auditoria
- [ ] 7.8 Testes: conexão, RLS de terceiro, modos, arredondamento, soma ≠ total, materialização, acerto, edição/exclusão

## 8. Grupos de divisão (Etapa 2)
Decisões padrão: upgrade de "só divisão" para completa apenas por convite normal de usuário
completo; membro sem conta (só nome) incluído, vinculável depois.
- [ ] 8.1 Tipos/período/status; encerrar trava lançamentos
- [ ] 8.2 Link de convite (hash, validade, usos, revogação, compartilhar)
- [ ] 8.3 Conta split_only bloqueada no servidor fora do módulo; limites anti-abuso
- [ ] 8.4 Membro sem conta
- [ ] 8.5 Saldos, simplificar dívidas, acerto confirmado
- [ ] 8.6 Materialização opcional para conta completa
- [ ] 8.7 Feed de atividade e CSV de encerramento

## 9. Testes e qualidade (contínuo)
- [ ] 9.1 http-run com as novas funcionalidades
- [ ] 9.2 Fluxos principais na tela (desktop e celular)
- [ ] 9.3 Restauração de backup com tabelas novas
