# Roadmap — Finance Intelligence

Princípio: tudo que o usuário faz (ler fatura, subir planilha, cadastrar empréstimo, dividir
compra) acontece **dentro do app**, no computador ou no celular. O desenvolvimento só cria e
ajusta a estrutura. Documentos originais não são guardados; somente o que o usuário confirma.

## Concluído (até 7 nov 2026)

- **Base 0.2:** contas, lançamentos, compromissos, contratos, projeção, auditoria, backup
  criptografado, leitura temporária de PDF/imagem/texto e CSV/OFX.
- **Produção:** Vercel + Supabase (papel restrito, RLS, Data API fechada), base pessoal migrada.
- **Multiusuário:** convites de uso único; dados isolados por usuário; bloqueio por e-mail.
- **Cartões:** cartão como conta (banco, bandeira, titular, final, fechamento, vencimento,
  limite); leitura de fatura identifica o cartão e lança as compras nele; pagamento da fatura
  como transferência; projeção desconta a fatura no vencimento.
- **Categorias:** grupo / subcategoria (Alimentação / Mercado, Delivery…), sugestão automática
  com memória das escolhas, categorias próprias, troca e divisão de um lançamento entre
  categorias, relatório por grupo e subcategoria.

## Próximas fases

### Fase A — Importar planilha no app (.xlsx) — feito (7 nov), melhorias futuras
Assistente em Importações: escolher o arquivo, o app reconhece os formatos e mostra tudo para
revisão (marcar/desmarcar, categoria sugerida, conta ou cartão) antes de gravar.
- Abas mensais "Descrição · Valor · Vencimento · Pagamento · Status · Observação" → compromissos
  (PENDENTE) ou pagamentos (PAGO, na conta escolhida); vencimento como data ou só o dia.
- Blocos de parcelas ("24X 178,85", "60 × 104,72" com datas e status) → empréstimos/acordos
  com parcelas pagas marcadas.
- Blocos de assinaturas/gastos fixos com forma de pagamento → compromissos recorrentes
  vinculados ao cartão.
- Itens repetidos entre meses (Netflix, aluguel) agrupados; reimportar não duplica.

### Fase B — Empréstimos e acordos no app — feito (7 nov), melhorias futuras
- "Peguei emprestado" ou "Emprestei", com pessoa/instituição, **valor total, nº de parcelas,
  dia do mês** (o app divide e gera as parcelas) ou valores parcela a parcela.
- Ler o print/foto com os valores (OCR) ou digitar manualmente.
- Marcar parcela paga/recebida (vira pagamento na conta), saldo devedor e quitação antecipada.
- Visão "Quanto devo / quanto me devem" e parcelas na projeção.

### Fase C — Nota de mercado
- Foto/PDF/texto do cupom (NFC-e) → itens com categoria sugerida por produto (comida → Mercado,
  detergente → Limpeza, travesseiro → Cama, mesa e banho) e memória por produto.
- Encontrar a compra correspondente no cartão/conta e dividi-la automaticamente; descontos
  rateados; soma sempre igual ao total pago.
- Opcional: chave/QR da NFC-e na consulta pública da SEFAZ-RS (validar viabilidade antes).

### Fase D — Faturas de cartão completas
- Fechamento: compras após o fechamento vão para a próxima fatura; fatura atual × próxima.
- Parcelamentos ("PARC 03/10") geram as parcelas futuras como previstas.
- Limite disponível, alerta de limite e conferência fatura lida × lançamentos.

### Fase E — Orçamentos e metas
- Limite mensal por grupo/subcategoria (ex.: Delivery até R$ 400) com alerta ao se aproximar.
- Metas de economia e reserva; acompanhamento mês a mês.

### Fase F — Relatórios
- Comparação mês a mês por categoria, evolução de gastos, maiores estabelecimentos.
- Exportar CSV/Excel do período.

### Fase G — Conta e segurança (sessão deslizante e "sair de todos" feitos; 2FA fora do escopo)
- Pendente: recuperação de senha por e-mail (requer serviço de envio de e-mail).
- Recuperação de senha por e-mail, MFA, encerrar sessões em outros aparelhos.
- Infra: "Enforce SSL" no Supabase, APP_ORIGIN definitivo, backups automáticos.

### Fase I — App instalável (PWA)
- Manifest, ícones, apple-touch-icon, service worker mínimo sem cache de dados, card
  "Instalar app" em Configurações; avaliar sessão de 12h no app instalado.

### Fase J — Despesas compartilhadas (Etapa 1)
- Conexões entre usuários, grupo permanente (ex.: Casa), despesa dividida (igual, selecionados,
  valores exatos, %), parte de cada um lançada no próprio ledger sem dupla contagem, acerto.
- Plano contábil a aprovar antes de implementar.

### Fase K — Grupos de divisão (Etapa 2) — pronta, publicação pendente
- Viagem/Evento, convite por link, conta "só divisão", simplificar dívidas, feed, CSV.

### Fase H — Depois
- Consultor IA sobre os dados estruturados (perguntas, simulações), com cálculos verificáveis e
  propostas sujeitas à confirmação.
- Gmail com OAuth próprio e consentimento mínimo (faturas e boletos por e-mail).
