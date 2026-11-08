"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
  Wallet,
  X,
  CreditCard,
  Pencil,
  HandCoins,
} from "lucide-react";
import { brl, cents, decimal, localToday } from "@/lib/money";
import { categoryBreakdown, forecast, isCard, nextDueDate, totals } from "@/lib/finance";
import { cardStatus } from "@/lib/card-cycle";
import type { FinanceState, ForecastPoint, Movement } from "@/lib/types";
import SourceIntake, { ContractTerms, normalizeContractForm } from "./source-intake";
import CandidateEditor from "./candidate-editor";
import BackupPanel from "./backup-panel";
import InvitePanel from "./invite-panel";
import InstallPanel from "./install-panel";
import SessionPanel from "./session-panel";
import CategoryPanel from "./category-panel";
import MovementCategoryEditor from "./movement-category";
import LoansPage from "./loans-page";
import SheetImport from "./sheet-import";
import ReceiptImport from "./receipt-import";
import { CardFields, accountLabel, accountTypeLabel } from "./card-fields";
import { categoryList, DIVIDED } from "@/lib/categorize";
import { obligationStage } from "@/lib/intake";

type Page =
  | "overview"
  | "transactions"
  | "accounts"
  | "obligations"
  | "contracts"
  | "loans"
  | "imports"
  | "forecast"
  | "settings";
type Modal =
  | "account"
  | "movement"
  | "obligation"
  | "contract"
  | "settle"
  | "reverse"
  | "accountEdit"
  | "categorize"
  | null;
const navigation = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "transactions", label: "Lançamentos", icon: ArrowRightLeft },
  { id: "accounts", label: "Minhas contas", icon: Wallet },
  { id: "obligations", label: "Compromissos", icon: CalendarDays },
  { id: "contracts", label: "Contratos", icon: FileText },
  { id: "loans", label: "Empréstimos", icon: HandCoins },
  { id: "imports", label: "Importações", icon: Upload },
  { id: "forecast", label: "Projeção de caixa", icon: TrendingUp },
] as const;
const pageText: Record<Page, { title: string; subtitle: string }> = {
  overview: {
    title: "Sua vida financeira, em perspectiva.",
    subtitle: "Entenda o presente. Prepare o próximo passo.",
  },
  transactions: {
    title: "Cada movimento, no seu lugar.",
    subtitle: "Entradas, saídas e transferências com histórico rastreável.",
  },
  accounts: {
    title: "Um lugar para todas as suas contas.",
    subtitle:
      "Saldos calculados a partir de uma referência informada por você.",
  },
  obligations: {
    title: "O futuro já tem alguns compromissos.",
    subtitle: "Organize vencimentos e acompanhe o que ainda está em aberto.",
  },
  contracts: {
    title: "Mais clareza sobre o que foi combinado.",
    subtitle: "Transforme condições contratuais em compromissos futuros.",
  },
  loans: {
    title: "Quem deve a quem, sem esquecer nada.",
    subtitle:
      "Empréstimos com pessoas ou bancos e acordos de dívida, parcela por parcela.",
  },
  imports: {
    title: "Menos digitação. Mais controle.",
    subtitle:
      "Importe movimentos, revise os registros e confirme o que entra na sua base.",
  },
  forecast: {
    title: "Olhe à frente com mais clareza.",
    subtitle:
      "Uma projeção verificável, baseada nos saldos e compromissos cadastrados.",
  },
  settings: {
    title: "Sua central, com transparência.",
    subtitle: "Acompanhe a base, a auditoria e as próximas etapas do produto.",
  },
};
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
const cleanMoney = (value: string) =>
  value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  ).catch(() => {
    throw new Error("Não foi possível conectar ao Finance Intelligence. Verifique se o servidor está ligado e acesse http://127.0.0.1:3000 neste computador. Antes de repetir um cadastro, atualize a página e confira se ele foi salvo.");
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Amount({
  name = "amount",
  defaultValue,
  negative = false,
}: {
  name?: string;
  defaultValue?: string;
  negative?: boolean;
}) {
  return (
    <input
      name={name}
      defaultValue={defaultValue}
      placeholder="0,00"
      inputMode="decimal"
      required
      pattern={negative ? "[-]?[0-9.,]+" : "[0-9.,]+"}
      maxLength={18}
    />
  );
}
/** Categoria com sugestões (prontas + suas + já usadas); aceita digitar uma nova. */
function Category() {
  return (
    <Field label="Categoria">
      <input
        name="category"
        list="category-list"
        defaultValue="Sem categoria"
        required
        maxLength={80}
        autoComplete="off"
        onFocus={(e) => e.currentTarget.value === "Sem categoria" && e.currentTarget.select()}
      />
    </Field>
  );
}
function Empty({
  icon: Icon = Wallet,
  title,
  description,
  action,
}: {
  icon?: typeof Wallet;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "orange" | "red";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function CashChart({ points }: { points: ForecastPoint[] }) {
  const values = points.map((p) => Number(p.balance));
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    range = max - min || 1;
  const x = (i: number) => 64 + (i / Math.max(points.length - 1, 1)) * 676;
  const y = (v: number) => 190 - ((v - min) / range) * 150;
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i)},${y(Number(p.balance))}`)
    .join(" ");
  return (
    <div className="chart">
      <svg
        viewBox="0 0 770 240"
        role="img"
        aria-label={`Projeção de caixa: saldo final ${brl(points.at(-1)?.balance || "0")}`}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#137567" stopOpacity=".17" />
            <stop offset="100%" stopColor="#137567" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="64"
              x2="740"
              y1={40 + f * 150}
              y2={40 + f * 150}
              stroke="#e7ece9"
              strokeDasharray="4 5"
            />
            <text x="0" y={44 + f * 150} fontSize="11" fill="#7f8e89">
              {new Intl.NumberFormat("pt-BR", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(max - f * range)}
            </text>
          </g>
        ))}
        <path d={`${line} L740,191 L64,191 Z`} fill="url(#chart-fill)" />
        {min < 0 && (
          <line
            x1="64"
            x2="740"
            y1={y(0)}
            y2={y(0)}
            stroke="#cf745c"
            strokeDasharray="4 4"
          />
        )}
        <path
          d={line}
          fill="none"
          stroke="#167b6a"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map(
          (i, k) => (
            <text
              key={k}
              x={x(i)}
              y="222"
              textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
              fill="#7f8e89"
              fontSize="11"
            >
              {dateLabel(points[i].date)}
            </text>
          ),
        )}
        <circle
          cx="740"
          cy={y(values.at(-1) || 0)}
          r="5"
          fill="#167b6a"
          stroke="white"
          strokeWidth="3"
        />
      </svg>
    </div>
  );
}

function Login({
  needsSetup,
  requiresSetupToken,
  onDone,
}: {
  needsSetup: boolean;
  requiresSetupToken: boolean;
  onDone: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [registering, setRegistering] = useState(false);
  const creating = needsSetup || registering;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await request("/api/auth", {
        action: needsSetup ? "setup" : registering ? "register" : "login",
        name: form.get("name") || undefined,
        email: form.get("email"),
        password: form.get("password"),
        setup_token: form.get("setup_token") || undefined,
        invite_code: form.get("invite_code") || undefined,
      });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-shell">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <Activity size={24} />
          </span>
          <span>
            finance<span className="brand-sub">INTELLIGENCE</span>
          </span>
        </div>
        <div className="login-copy">
          <span className="eyebrow light">CLAREZA PARA DECIDIR MELHOR</span>
          <h1>
            Seu dinheiro.
            <br />
            Uma visão
            <br />
            <em>mais completa.</em>
          </h1>
          <p>
            Conecte seus movimentos de hoje aos planos de amanhã. Tudo começa
            com uma base confiável.
          </p>
          <div className="login-points">
            <span>
              <CheckCircle2 size={17} /> Contas e compromissos organizados
            </span>
            <span>
              <CheckCircle2 size={17} /> Projeções com memória de cálculo
            </span>
            <span>
              <CheckCircle2 size={17} /> Cada registro com sua origem
            </span>
          </div>
        </div>
        <span className="login-foot">
          CENTRAL DE INTELIGÊNCIA FINANCEIRA PESSOAL
        </span>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <span className="eyebrow">SEU ESPAÇO FINANCEIRO</span>
          <h2>
            {needsSetup
              ? "Vamos começar."
              : registering
                ? "Crie seu acesso."
                : "Bom ter você de volta."}
          </h2>
          <p>
            {needsSetup
              ? "Crie seu acesso pessoal para organizar sua vida financeira."
              : registering
                ? "Use o convite que você recebeu. Seus dados ficam separados dos de quem convidou."
                : "Entre para acompanhar suas contas e próximos compromissos."}
          </p>
          {!needsSetup && (
            <div className="auth-switch" role="tablist" aria-label="Tipo de acesso">
              <button
                type="button"
                role="tab"
                aria-selected={!registering}
                className={!registering ? "active" : ""}
                onClick={() => { setRegistering(false); setError(""); }}
              >
                Entrar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={registering}
                className={registering ? "active" : ""}
                onClick={() => { setRegistering(true); setError(""); }}
              >
                Tenho um convite
              </button>
            </div>
          )}
          <form onSubmit={submit} key={registering ? "register" : "login"}>
            {creating && (
              <Field label="Como podemos chamar você?">
                <input
                  name="name"
                  autoComplete="given-name"
                  maxLength={100}
                  required
                  placeholder="Seu nome"
                />
              </Field>
            )}
            {needsSetup && requiresSetupToken && <Field label="Código de ativação"><input name="setup_token" type="password" autoComplete="off" required maxLength={200}/><small>Use o código privado configurado na instalação.</small></Field>}
            {registering && !needsSetup && (
              <Field label="Código de convite">
                <input
                  name="invite_code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                  maxLength={40}
                  placeholder="XXXX-XXXX-XXXX"
                />
                <small>Peça a quem já usa o sistema: Configurações → Convidar pessoa.</small>
              </Field>
            )}
            <Field label="E-mail">
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="voce@exemplo.com"
              />
            </Field>
            <Field label="Senha">
              <input
                name="password"
                type="password"
                autoComplete={creating ? "new-password" : "current-password"}
                required
                minLength={12}
                maxLength={128}
                placeholder="Pelo menos 12 caracteres"
              />
            </Field>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy
                ? "Preparando seu espaço…"
                : creating
                  ? "Criar meu acesso"
                  : "Entrar na minha central"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <span>
              Cada pessoa vê apenas os próprios dados. Não há conexão
              automática com bancos ou e-mails.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function FinanceApp() {
  const [auth, setAuth] = useState<{
    needsSetup: boolean;
    requiresSetupToken: boolean;
    user: { id: string; name: string; email: string } | null;
  } | null>(null);
  const [data, setData] = useState<FinanceState | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>("overview"),
    [sidebar, setSidebar] = useState(false);
  const [month, setMonth] = useState(() => localToday().slice(0, 7)),
    [accountFilter, setAccountFilter] = useState(""),
    [search, setSearch] = useState("");
  const [settlementId, setSettlementId] = useState("");
  const [modal, setModal] = useState<Modal>(null),
    [target, setTarget] = useState(""),
    [kind, setKind] = useState("expense"),
    [accountType, setAccountType] = useState("checking"),
    [transferTo, setTransferTo] = useState(""),
    [busy, setBusy] = useState(false);
  const [days, setDays] = useState(30),
    [simulation, setSimulation] = useState(""),
    [batchId, setBatchId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [confirmDistinct, setConfirmDistinct] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    const session = await request<NonNullable<typeof auth>>("/api/auth");
    setAuth(session);
    if (session.user) setData(await request<FinanceState>("/api/finance"));
    else setData(null);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
  }, [modal]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const activeBatch =
    batchId || data?.batches.find((b) => b.status === "review")?.id || "";
  const candidates = useMemo(
    () => data?.candidates.filter((c) => c.batch_id === activeBatch) || [],
    [data, activeBatch],
  );
  useEffect(() => {
    setSelected(
      candidates.filter((c) => c.duplicate === "new").map((c) => c.id),
    );
    setConfirmDistinct(false);
  }, [candidates]);
  const navigate = (id: Page) => {
    setPage(id);
    setSidebar(false);
    setError("");
  };
  function open(type: Modal, id = "") {
    setTarget(id);
    setKind("expense");
    setAccountType("checking");
    setTransferTo("");
    setSettlementId("");
    setError("");
    setModal(type);
  }
  /** Pagamento de fatura = transferência da conta escolhida para o cartão (não é despesa nova). */
  function payCard(cardId: string) {
    open("movement");
    setKind("transfer");
    setTransferTo(cardId);
  }
  async function act(
    action: string,
    payload: unknown,
    message = "Alteração salva.",
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        id: string;
        count?: number;
        skipped?: number;
      }>("/api/finance", { action, payload });
      await load();
      setNotice(message);
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(form.entries()) as Record<string, string>;
    if (fields.amount) fields.amount = cleanMoney(fields.amount);
    if (fields.opening_balance)
      fields.opening_balance = cleanMoney(fields.opening_balance);
    if (fields.credit_limit) fields.credit_limit = cleanMoney(fields.credit_limit);
    try {
      if (modal === "account")
        await act(
          "account.create",
          fields,
          fields.type === "credit_card"
            ? "Cartão cadastrado. Compras lidas de faturas podem ser vinculadas a ele."
            : "Conta cadastrada. Seu saldo inicial já está disponível.",
        );
      if (modal === "accountEdit")
        await act("account.update", { ...fields, id: target }, "Dados atualizados.");
      if (modal === "movement")
        await act(
          "movement.create",
          {
            ...fields,
            destination_account_id:
              fields.kind === "transfer"
                ? fields.destination_account_id
                : undefined,
          },
          "Lançamento registrado. Saldos atualizados.",
        );
      if (modal === "obligation")
        await act(
          "obligation.create",
          fields,
          "Compromisso incluído na projeção.",
        );
      if (modal === "contract")
        await act(
          "contract.create",
          normalizeContractForm(form),
          "Contrato salvo e compromissos mensais gerados.",
        );
      if (modal === "settle")
        await act(
          "obligation.settle",
          {
            ...fields,
            id: target,
            existing_transaction_id: settlementId || undefined,
          },
          "Compromisso liquidado e movimentação registrada.",
        );
      if (modal === "reverse")
        await act(
          "movement.reverse",
          { ...fields, id: target },
          "Lançamento estornado. O histórico foi preservado.",
        );
      setModal(null);
    } catch {}
  }
  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element=event.currentTarget;
    const form = new FormData(element);
    const file = form.get("file") as File;
    if (!file || file.size > 2_000_000) {
      setError("Escolha um CSV ou OFX de até 2 MB.");
      return;
    }
    try {
      const result = await act(
        "import.stage",
        {
          account_id: form.get("account_id"),
          filename: file.name,
          format: file.name.toLowerCase().endsWith(".ofx") ? "ofx" : "csv",
          content: await file.text(),
        },
        "Arquivo lido. Revise os candidatos antes de confirmar.",
      );
      setBatchId(result.id);
    } catch {} finally {element.reset();}
  }
  if (!auth)
    return (
      <div className="loading">
        <Activity size={34} />
        <h2>Finance Intelligence</h2>
        {error ? (
          <>
            <p className="error">{error}</p>
            <button
              className="button"
              onClick={() => {
                setError("");
                load().catch((e) => setError(e.message));
              }}
            >
              Tentar novamente
            </button>
          </>
        ) : (
          <p>Preparando sua central financeira…</p>
        )}
      </div>
    );
  if (!auth.user) return <Login needsSetup={auth.needsSetup} requiresSetupToken={auth.requiresSetupToken} onDone={load} />;
  if (!data)
    return (
      <div className="loading">
        <Activity size={34} />
        <p>{error || "Carregando sua base…"}</p>
        <button
          className="button"
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Atualizar
        </button>
      </div>
    );
  const sum = totals(data.transactions, month);
  // Disponível = contas (sem cartões). Cartões mostram a fatura em aberto separadamente.
  const bankAccounts = data.accounts.filter((a) => !isCard(a));
  const cards = data.accounts.filter(isCard);
  const balance = decimal(bankAccounts.reduce((n, a) => n + cents(a.balance), 0n));
  const cardDebt = decimal(
    cards.reduce((n, a) => n + (cents(a.balance) < 0n ? -cents(a.balance) : 0n), 0n),
  );
  const usedCategories = [
    ...data.transactions.map((t) => t.category),
    ...data.obligations.map((o) => o.category),
  ];
  const allCategories = categoryList(data.categories, usedCategories);
  const projection = forecast(
    data.accounts,
    data.obligations,
    data.today,
    days,
    false,
    data.transactions,
  );
  const ending = projection.at(-1)!.balance;
  const openObligations = data.obligations.filter((o) => o.status === "open" && o.stage !== 'estimated');
  const overdue = openObligations.filter((o) => o.due_date < data.today);
  const risk = projection.find((p) => cents(p.balance) < 0n);
  const filtered = data.transactions.filter(
    (t) =>
      t.date.startsWith(month) &&
      (!accountFilter ||
        t.account_id === accountFilter ||
        t.destination_account_id === accountFilter) &&
      `${t.description} ${t.category}`.toLowerCase().includes(search),
  );
  const allSplits = data.splits;
  const accountName = (id: string) =>
    data.accounts.find((a) => a.id === id)?.name || "Conta";
  const options = data.accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {accountLabel(a)}
    </option>
  ));
  const exportURL = `/api/export?month=${encodeURIComponent(month)}&account=${encodeURIComponent(accountFilter)}&search=${encodeURIComponent(search)}`;
  // Por grupo (Alimentação, Casa…) com subcategorias; lançamentos divididos entram pelas partes.
  const categories = categoryBreakdown(data.transactions, data.splits, month);
  const expenses = cents(sum.expense);
  const modalTitle = {
    account: "Adicionar conta",
    movement: "Novo lançamento",
    obligation: "Novo compromisso",
    contract: "Novo contrato recorrente",
    settle: "Liquidar compromisso",
    reverse: "Estornar lançamento",
    accountEdit: "Editar conta ou cartão",
    categorize: "Categoria do lançamento",
  };
  function MovementTable({ rows }: { rows: Movement[] }) {
    return !rows.length ? (
      <Empty
        icon={ArrowRightLeft}
        title="Nenhum movimento neste período"
        description="Adicione um lançamento ou importe um extrato para começar."
        action={
          <button className="text-button" onClick={() => open("movement")}>
            Adicionar lançamento <ArrowRight size={15} />
          </button>
        }
      />
    ) : (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Descrição / categoria</th>
              <th>Data</th>
              <th>Conta</th>
              <th>Situação</th>
              <th className="align-right">Valor</th>
              <th>
                <span className="sr-only">Ação</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                className={t.status === "reversed" ? "reversed" : ""}
              >
                <td>
                  <div className="description-cell">
                    <span className={`movement-icon ${t.kind}`}>
                      {t.kind === "income" ? (
                        <ArrowDownLeft size={17} />
                      ) : t.kind === "transfer" ? (
                        <ArrowRightLeft size={17} />
                      ) : (
                        <ArrowUpRight size={17} />
                      )}
                    </span>
                    <span>
                      <strong>{t.description}</strong>
                      {t.kind === "transfer" ? (
                        <small>{t.category}</small>
                      ) : (
                        <button
                          type="button"
                          className="category-link"
                          title="Trocar ou dividir a categoria"
                          onClick={() => open("categorize", t.id)}
                        >
                          {t.category === DIVIDED
                            ? allSplits
                                .filter((s) => s.transaction_id === t.id)
                                .map((s) => `${s.category} ${brl(s.amount)}`)
                                .join(" · ")
                            : t.category}
                          <Pencil size={11} />
                        </button>
                      )}
                    </span>
                  </div>
                </td>
                <td>{dateLabel(t.date)}</td>
                <td>
                  {accountName(t.account_id)}
                  {t.destination_account_id && (
                    <small>→ {accountName(t.destination_account_id)}</small>
                  )}
                </td>
                <td>
                  <Badge tone={t.status === "reversed" ? "neutral" : "green"}>
                    {t.status === "reversed" ? "Estornado" : "Realizado"}
                  </Badge>
                </td>
                <td
                  className={`align-right amount ${t.kind === "income" ? "positive" : ""}`}
                >
                  {t.kind === "income"
                    ? "+ "
                    : t.kind === "expense"
                      ? "− "
                      : ""}
                  {brl(t.amount)}
                </td>
                <td>
                  {t.status === "posted" && (
                    <button
                      className="row-action"
                      onClick={() => open("reverse", t.id)}
                    >
                      Estornar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <datalist id="category-list">
        {allCategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Fechar menu"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? "shown" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-icon">
            <Activity size={24} />
          </span>
          <span>
            finance<span className="brand-sub">INTELLIGENCE</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">P</span>
          <div>
            Meu espaço pessoal<small>Finanças em perspectiva</small>
          </div>
          <ShieldCheck size={15} />
        </div>
        <span className="nav-heading">SUA CENTRAL</span>
        <nav aria-label="Navegação principal">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => navigate(id)}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={19} />
              {label}
              {id === "imports" &&
                data.batches.some((b) => b.status === "review") && (
                  <i className="nav-dot" />
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sparkles size={18} />
            <strong>Clareza antes da decisão.</strong>
            <p>Uma base organizada é o primeiro passo para planejar melhor.</p>
          </div>
          <button
            className={`settings-link ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} /> Configurações e histórico
          </button>
          <div className="profile">
            <span className="avatar">
              {auth.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              {auth.user.name}
              <small>Conta pessoal</small>
            </div>
            <button
              aria-label="Sair"
              title="Sair"
              onClick={async () => {
                try {
                  await request("/api/auth", { action: "logout" });
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Abrir menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <span>Meu espaço</span>
            <ChevronRight size={13} />
            <strong>
              {page === "settings"
                ? "Configurações"
                : navigation.find((n) => n.id === page)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="private-status">
              <span /> Espaço privado
            </span>
            <button
              className="icon-button"
              aria-label="Ver compromissos pendentes"
              onClick={() => navigate("obligations")}
            >
              <Bell size={19} />
              {overdue.length > 0 && <i className="notification-dot" />}
            </button>
            <span className="avatar small">
              {auth.user.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "overview"
                  ? `OLÁ, ${auth.user.name.split(" ")[0].toUpperCase()}`
                  : "FINANCE INTELLIGENCE"}
              </span>
              <h1>{pageText[page].title}</h1>
              <p>{pageText[page].subtitle}</p>
            </div>
            {["overview", "transactions"].includes(page) && (
              <button
                className="button primary"
                onClick={() => open("movement")}
              >
                <Plus size={17} /> Novo lançamento
              </button>
            )}
            {page === "accounts" && (
              <button
                className="button primary"
                onClick={() => open("account")}
              >
                <Plus size={17} /> Adicionar conta
              </button>
            )}
            {page === "obligations" && (
              <button
                className="button primary"
                onClick={() => open("obligation")}
              >
                <Plus size={17} /> Novo compromisso
              </button>
            )}
            {page === "contracts" && (
              <button
                className="button primary"
                onClick={() => open("contract")}
              >
                <Plus size={17} /> Novo contrato
              </button>
            )}
          </div>
          {error && !modal && (
            <div className="error banner" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Fechar erro"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="section-toolbar">
                <div className="segmented">
                  <span className="selected">Visão de caixa</span>
                  <span className="hint">
                    <ShieldCheck size={14} /> Dados registrados
                  </span>
                </div>
                <label className="month-picker">
                  <CalendarDays size={16} />
                  <input
                    aria-label="Mês dos indicadores realizados"
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </label>
              </div>
              {!data.accounts.length && (
                <div className="welcome-banner">
                  <div className="welcome-icon">
                    <Landmark size={24} />
                  </div>
                  <div>
                    <strong>
                      Seu primeiro passo: uma conta e um saldo de referência.
                    </strong>
                    <p>
                      A partir daí, cada movimento ajuda a construir uma visão
                      real das suas finanças.
                    </p>
                  </div>
                  <button className="button" onClick={() => open("account")}>
                    Adicionar conta <ArrowRight size={16} />
                  </button>
                </div>
              )}
              <div className="metrics">
                <div className="metric featured">
                  <div className="metric-label">
                    Saldo disponível nas contas <Wallet size={18} />
                  </div>
                  <strong>{brl(balance)}</strong>
                  <span>
                    {bankAccounts.length}{" "}
                    {bankAccounts.length === 1
                      ? "conta cadastrada"
                      : "contas cadastradas"}{" "}
                    · hoje
                    {cards.length > 0 &&
                      ` · faturas em aberto: ${brl(cardDebt)}`}
                  </span>
                  <div className="metric-decoration" />
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Receitas recebidas{" "}
                    <span className="metric-icon green">
                      <ArrowDownLeft size={17} />
                    </span>
                  </div>
                  <strong>{brl(sum.income)}</strong>
                  <span>
                    <i className="dot green" /> Realizado no mês selecionado
                  </span>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Despesas pagas{" "}
                    <span className="metric-icon orange">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                  <strong>{brl(sum.expense)}</strong>
                  <span>
                    <i className="dot orange" /> Realizado no mês selecionado
                  </span>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Saldo em {days} dias <TrendingUp size={18} />
                  </div>
                  <strong className={cents(ending) < 0n ? "negative" : ""}>
                    {brl(ending)}
                  </strong>
                  <span>
                    <i className="dot neutral" /> Projeção · compromissos
                    conhecidos
                  </span>
                </div>
              </div>
              <div className="dashboard-grid">
                <section className="panel forecast-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>O caminho do seu saldo</h2>
                      <p>Projeção a partir de hoje</p>
                    </div>
                    <select
                      aria-label="Horizonte da projeção"
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    >
                      <option value={7}>7 dias</option>
                      <option value={30}>30 dias</option>
                      <option value={60}>60 dias</option>
                      <option value={90}>90 dias</option>
                    </select>
                  </div>
                  {data.accounts.length ? (
                    <>
                      <CashChart points={projection} />
                      <div className="chart-foot">
                        <span>
                          <i className="dot green" /> Saldo projetado
                        </span>
                        <span>Não inclui estimativas nem gastos não cadastrados</span>
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={TrendingUp}
                      title="Seu futuro financeiro começa com dados"
                      description="Cadastre uma conta e seus próximos recebimentos e pagamentos."
                    />
                  )}
                </section>
                <section className="panel insights-panel">
                  <div className="panel-heading">
                    <h2>
                      <Sparkles size={18} /> Leitura financeira
                    </h2>
                    <Badge>Regras</Badge>
                  </div>
                  <div className="insights">
                    <div className={`insight ${risk ? "warning" : ""}`}>
                      <span className="insight-symbol">
                        {risk ? <Bell size={19} /> : <ShieldCheck size={19} />}
                      </span>
                      <div>
                        <strong>
                          {risk
                            ? "Atenção ao caixa projetado"
                            : !data.accounts.length
                              ? "Vamos construir sua base"
                              : "Acompanhe a cobertura dos dados"}
                        </strong>
                        <p>
                          {risk
                            ? `O saldo pode ficar em ${brl(risk.balance)} em ${dateLabel(risk.date)}. Revise os compromissos deste período.`
                            : !data.accounts.length
                              ? "Adicione seus saldos e compromissos. A análise aparece conforme você registra informações."
                              : "A projeção considera apenas compromissos cadastrados. Despesas ainda não registradas podem alterar o resultado."}
                        </p>
                      </div>
                    </div>
                    {overdue.length > 0 && (
                      <div className="insight warning">
                        <span className="insight-symbol">
                          <CalendarDays size={19} />
                        </span>
                        <div>
                          <strong>
                            {overdue.length} compromisso(s) em atraso
                          </strong>
                          <p>
                            Os valores em aberto foram incluídos no primeiro dia
                            da projeção.
                          </p>
                        </div>
                      </div>
                    )}
                    <button
                      className="text-button"
                      onClick={() => navigate("forecast")}
                    >
                      Explorar projeção <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="insight-footer">
                    <CircleHelp size={14} /> Cálculos determinísticos, com dados
                    da sua base.
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Próximos compromissos</h2>
                      <p>O que merece sua atenção</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("obligations")}
                    >
                      Ver todos <ArrowRight size={14} />
                    </button>
                  </div>
                  {openObligations.length ? (
                    <div className="commitment-list">
                      {openObligations.slice(0, 4).map((o) => (
                        <div className="commitment-row" key={o.id}>
                          <div className="date-tile">
                            <strong>{o.due_date.slice(8)}</strong>
                            <span>
                              {new Date(o.due_date + "T12:00:00Z")
                                .toLocaleDateString("pt-BR", {
                                  month: "short",
                                  timeZone: "UTC",
                                })
                                .replace(".", "")}
                            </span>
                          </div>
                          <div className="grow">
                            <strong>{o.description}</strong>
                            <small>
                              {o.category}{" "}
                              {o.due_date < data.today ? "· Em atraso" : ""}
                            </small>
                          </div>
                          <strong
                            className={o.kind === "income" ? "positive" : ""}
                          >
                            {brl(o.amount)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={CalendarDays}
                      title="Nenhum vencimento cadastrado"
                      description="Organize suas próximas contas e receitas."
                      action={
                        <button
                          className="text-button"
                          onClick={() => open("obligation")}
                        >
                          Adicionar compromisso <Plus size={14} />
                        </button>
                      }
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Para onde foi seu dinheiro</h2>
                      <p>Despesas por grupo · toque para ver as subcategorias</p>
                    </div>
                    <span className="subtle-icon">
                      <ArrowUpRight size={18} />
                    </span>
                  </div>
                  {categories.length ? (
                    <div className="categories">
                      {categories.map(({ group, total, subs }, i) => (
                        <details key={group} className="category-group">
                          <summary>
                            <div className="category-label">
                              <span>
                                <i className={`category-dot shade-${Math.min(i, 4)}`} />
                                {group}
                              </span>
                              <strong>{brl(decimal(total))}</strong>
                            </div>
                            <div className="bar-track">
                              <span
                                className={`shade-${Math.min(i, 4)}`}
                                style={{
                                  width: `${expenses ? Number((total * 10000n) / expenses) / 100 : 0}%`,
                                }}
                              />
                            </div>
                          </summary>
                          <ul className="category-subs">
                            {subs.map((s) => (
                              <li key={s.name}>
                                <span>{s.name}</span>
                                <span>
                                  {brl(decimal(s.total))}
                                  <small>
                                    {total ? Math.round(Number((s.total * 1000n) / total) / 10) : 0}%
                                  </small>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={FileCheck2}
                      title="Tudo pronto para acompanhar"
                      description="Suas despesas realizadas aparecerão aqui, agrupadas por categoria."
                    />
                  )}
                </section>
              </div>
              <section className="panel transactions-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Últimos movimentos</h2>
                    <p>Registros do mês selecionado</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("transactions")}
                  >
                    Ver lançamentos <ArrowRight size={14} />
                  </button>
                </div>
                <MovementTable
                  rows={data.transactions
                    .filter((t) => t.date.startsWith(month))
                    .slice(0, 5)}
                />
              </section>
            </>
          )}
          {page === "transactions" && (
            <section className="panel">
              <div className="filter-toolbar">
                <label className="search-input">
                  <Search size={17} />
                  <input
                    placeholder="Buscar descrição ou categoria"
                    aria-label="Buscar lançamentos"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <input
                  type="month"
                  aria-label="Mês dos lançamentos"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
                <select
                  aria-label="Filtrar conta"
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                >
                  <option value="">Todas as contas</option>
                  {options}
                </select>
                <a className="button" href={exportURL}>
                  <ArrowDownToLine size={16} /> Exportar CSV
                </a>
              </div>
              <MovementTable rows={filtered} />
              <div className="table-footer">
                {filtered.length} registro(s) · transferências não compõem
                receitas e despesas.
              </div>
            </section>
          )}
          {page === "accounts" && (
            <>
              <div className="info-strip">
                <ShieldCheck size={18} />
                <p>Saldo calculado a partir do saldo inicial e dos lançamentos.</p>
              </div>
              {data.accounts.length ? (
                <div className="account-grid">
                  {data.accounts.map((a) => {
                    const card = isCard(a);
                    const debt = cents(a.balance) < 0n ? decimal(-cents(a.balance)) : "0.00";
                    const st = card ? cardStatus(a, data.transactions, data.today) : null;
                    return (
                    <section key={a.id} className={`panel account-card ${card ? "credit-card" : ""}`}>
                      <div className="account-card-top">
                        <span className="bank-icon">
                          {card ? <CreditCard size={23} /> : <Landmark size={23} />}
                        </span>
                        <Badge>{accountTypeLabel[a.type] || a.type}</Badge>
                      </div>
                      <h2>{a.name}</h2>
                      <p>
                        {[a.institution, card && a.card_brand, card && a.card_last4 && `final ${a.card_last4}`]
                          .filter(Boolean)
                          .join(" · ") || "Sem instituição informada"}
                      </p>
                      {card && a.card_holder && (
                        <p className="card-holder">Titular: {a.card_holder}</p>
                      )}
                      <span className="eyebrow">
                        {card ? "FATURA EM ABERTO" : "SALDO CALCULADO"}
                      </span>
                      <strong className="account-balance">
                        {brl(card ? debt : a.balance)}
                      </strong>
                      <div className="account-reference">
                        {card ? (
                          <>
                            {st && a.closing_day && a.due_day ? (
                              <>
                                {`Fechada: ${brl(decimal(st.closed))} · vence ${dateLabel(st.closedDue!)}`}
                                <span>{`Aberta: ${brl(decimal(st.open))} · fecha ${dateLabel(st.openCloses!)}`}</span>
                              </>
                            ) : (
                              <>
                                {a.due_day ? `Vence em ${dateLabel(nextDueDate(data.today, a.due_day))}` : "Informe vencimento e fechamento em Editar"}
                              </>
                            )}
                            {st && st.future > 0n && <span>{`Parcelas futuras: ${brl(decimal(st.future))}`}</span>}
                            {st && st.available !== null ? (
                              <span className={st.usage !== null && st.usage >= 90 ? "limit-alert" : ""}>
                                {`Disponível: ${brl(decimal(st.available))} de ${brl(a.credit_limit!)}${st.usage !== null ? ` (${Math.round(st.usage)}% usado)` : ""}`}
                              </span>
                            ) : (
                              <span>Limite não informado</span>
                            )}
                          </>
                        ) : (
                          <>
                            Inicial: {brl(a.opening_balance)}
                            <span>
                              Referência:{" "}
                              {new Date(
                                a.opening_date + "T12:00:00Z",
                              ).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="row-actions">
                        <button className="text-button" type="button" onClick={() => open("accountEdit", a.id)}>
                          <Pencil size={14} /> Editar
                        </button>
                        {card && cents(debt) > 0n && (
                          <button className="text-button" type="button" onClick={() => payCard(a.id)}>
                            <ArrowRightLeft size={14} /> Registrar pagamento da fatura
                          </button>
                        )}
                      </div>
                    </section>
                  );})}
                </div>
              ) : (
                <section className="panel">
                  <Empty
                    title="Vamos cadastrar sua primeira conta"
                    description="Pode ser uma conta bancária, poupança ou carteira de dinheiro."
                    action={
                      <button
                        className="button primary"
                        onClick={() => open("account")}
                      >
                        <Plus size={16} /> Adicionar conta
                      </button>
                    }
                  />
                </section>
              )}
            </>
          )}
          {page === "obligations" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Agenda financeira</h2>
                <Badge>{openObligations.length} em aberto</Badge>
              </div>
              {data.obligations.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Compromisso</th>
                        <th>Vencimento</th>
                        <th>Situação</th>
                        <th className="align-right">Valor</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.obligations.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <strong>{o.description}</strong>
                            <small>
                              {o.category} ·{" "}
                              {o.contract_id ? "Contrato" : "Manual"} ·{" "}
                              {o.kind === "income" ? "Receber" : "Pagar"}
                            </small>
                          </td>
                          <td>
                            {new Date(
                              o.due_date + "T12:00:00Z",
                            ).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                          </td>
                          <td>
                            <Badge
                              tone={
                                o.status === "paid"
                                  ? "green"
                                  : o.status === "open" && o.stage !== 'estimated' &&
                                      o.due_date < data.today
                                    ? "red"
                                    : "neutral"
                              }
                            >
                              {obligationStage(o,data.today)}
                            </Badge>
                          </td>
                          <td className="align-right amount">
                            {brl(o.amount)}
                          </td>
                          <td>
                            {o.status === "open" && (
                              <div className="row-actions">
                                <button
                                  className="row-action"
                                  onClick={() => open("settle", o.id)}
                                >
                                  Liquidar
                                </button>
                                <button
                                  className="row-action muted"
                                  disabled={busy}
                                  onClick={() =>
                                    act(
                                      "obligation.cancel",
                                      { id: o.id },
                                      "Compromisso cancelado.",
                                    ).catch(() => {})
                                  }
                                >
                                  Cancelar
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon={CalendarDays}
                  title="Sua agenda ainda está vazia"
                  description="Cadastre pagamentos e recebimentos futuros para alimentar a projeção."
                />
              )}
            </section>
          )}
          {page === "contracts" && (
            <>
              <div className="info-strip">
                <FileText size={18} />
                <p>Cada contrato gera os vencimentos mensais. Reajustes ficam como anotação.</p>
              </div>
              {data.contracts.length ? (
                <div className="account-grid">
                  {data.contracts.map((c) => (
                    <section className="panel contract-card" key={c.id}>
                      <div className="account-card-top">
                        <span className="bank-icon">
                          <FileText size={23} />
                        </span>
                        <Badge tone="green">{c.months} ocorrências</Badge>
                      </div>
                      <h2>{c.title}</h2>
                      <p>{c.counterparty}</p>
                      <strong className="account-balance">
                        {brl(c.amount)}
                        <small>/mês</small>
                      </strong>
                      <dl>
                        <div>
                          <dt>Vencimento</dt>
                          <dd>Dia {c.due_day}</dd>
                        </div>
                        <div>
                          <dt>Início</dt>
                          <dd>
                            {dateLabel(c.start_date)} /{" "}
                            {c.start_date.slice(0, 4)}
                          </dd>
                        </div>
                        <div>
                          <dt>Valor nominal total</dt>
                          <dd>
                            {brl(decimal(cents(c.amount) * BigInt(c.months)))}
                          </dd>
                        </div>
                      </dl>
                      <dl><div><dt>Vigência final</dt><dd>{c.end_date||'Não informada'}</dd></div><div><dt>Renovação</dt><dd>{c.renewal_date||'Não informada'}</dd></div><div><dt>Juros / CET</dt><dd>{c.interest_rate?`${c.interest_rate}% ${c.rate_period==='annual'?'a.a.':'a.m.'}`:'Não informado'} / {c.cet?`${c.cet}% ${c.cet_period==='monthly'?'a.m.':'a.a.'}`:'Não informado'}</dd></div></dl>
                      {c.penalty_note&&<p className="contract-note">Multas e encargos: {c.penalty_note}</p>}
                      {c.adjustment_note && (
                        <p className="contract-note">{c.adjustment_note}</p>
                      )}
                      <button
                        className="text-button"
                        onClick={() => navigate("obligations")}
                      >
                        Consultar compromissos <ArrowRight size={15} />
                      </button>
                    </section>
                  ))}
                </div>
              ) : (
                <section className="panel">
                  <Empty
                    icon={FileText}
                    title="Antecipe as despesas contratadas"
                    description="Aluguel, internet e serviços recorrentes podem gerar seus próximos vencimentos."
                    action={
                      <button
                        className="button primary"
                        onClick={() => open("contract")}
                      >
                        <Plus size={16} /> Cadastrar contrato
                      </button>
                    }
                  />
                </section>
              )}
            </>
          )}
          {page === "loans" && (
            <LoansPage data={data} act={act} onPay={(id) => open("settle", id)} />
          )}
          {page === "imports" && (
            <>
              <SourceIntake data={data} act={act}/>
              <ReceiptImport data={data} act={act}/>
              <SheetImport data={data} act={act}/>
              <div className="import-grid">
                <section className="panel import-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Importar extrato</h2>
                      <p>CSV padronizado ou OFX bancário · até 2 MB</p>
                    </div>
                    <Upload size={20} />
                  </div>
                  <form onSubmit={importFile} className="padded-form">
                    <Field label="Conta de destino">
                      <select name="account_id" required>
                        <option value="">Selecione a conta</option>
                        {options}
                      </select>
                    </Field>
                    <label className="upload-zone">
                      <Upload size={28} />
                      <strong>Selecione seu arquivo</strong>
                      <span>
                        Seus dados serão revisados antes de entrar na base.
                      </span>
                      <input
                        name="file"
                        type="file"
                        accept=".csv,.ofx"
                        required
                        aria-label="Arquivo CSV ou OFX"
                      />
                    </label>
                    <button
                      className="button primary full"
                      disabled={busy || !data.accounts.length}
                    >
                      {busy ? "Processando…" : "Ler arquivo e revisar"}
                      <ArrowRight size={16} />
                    </button>
                    {!data.accounts.length && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => open("account")}
                      >
                        Cadastre uma conta primeiro
                      </button>
                    )}
                  </form>
                </section>
                <section className="panel import-guide">
                  <span className="eyebrow">ANTES DE IMPORTAR</span>
                  <h2>
                    Uma fonte. Uma revisão.
                    <br />
                    Uma base confiável.
                  </h2>
                  <ol>
                    <li>
                      Para CSV, use <code>data;descricao;valor;categoria</code>.
                    </li>
                    <li>
                      Data no formato DD/MM/AAAA ou AAAA-MM-DD. Saídas com valor
                      negativo.
                    </li>
                    <li>
                      Exclua da seleção transferências próprias e pagamentos de
                      fatura; o suporte específico a cartões será implementado
                      em etapa posterior.
                    </li>
                    <li>
                      Possíveis duplicidades exigem revisão. O mesmo arquivo ou
                      identificador OFX não gera novo lançamento.
                    </li>
                  </ol>
                  <p>
                    O documento original não é armazenado. Candidatos CSV/OFX não confirmados expiram após 24 horas; a limpeza ocorre no próximo acesso. Gmail permanece planejado.
                  </p>
                </section>
              </div>
              <section className="panel review-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Área de revisão</h2>
                    <p>
                      Nenhum candidato afeta seu saldo antes da confirmação.
                    </p>
                  </div>
                  <select
                    aria-label="Lote de importação"
                    value={activeBatch}
                    onChange={(e) => setBatchId(e.target.value)}
                  >
                    <option value="">Selecione um lote</option>
                    {data.batches
                      .filter((b) => b.status === "review")
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.filename}
                        </option>
                      ))}
                  </select>
                </div>
                {activeBatch&&<div className="padded-form"><button className="text-button" disabled={busy} onClick={()=>act("import.discard",{id:activeBatch},"Rascunho descartado; dados confirmados preservados.").then(()=>setBatchId("")).catch(()=>{})}>Descartar rascunho</button></div>}
                {candidates.length ? (
                  <>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>
                              <input
                                type="checkbox"
                                aria-label="Selecionar novos registros"
                                checked={
                                  candidates.filter(
                                    (c) => c.duplicate === "new",
                                  ).length > 0 &&
                                  candidates
                                    .filter((c) => c.duplicate === "new")
                                    .every((c) => selected.includes(c.id))
                                }
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? candidates
                                          .filter((c) => c.duplicate === "new")
                                          .map((c) => c.id)
                                      : [],
                                  )
                                }
                              />
                            </th>
                            <th>Descrição</th>
                            <th>Data</th>
                            <th>Valor</th>
                            <th>Verificação</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidates.map((c) => (
                            <tr key={c.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`Importar ${c.description}`}
                                  disabled={c.duplicate === "exact"}
                                  checked={selected.includes(c.id)}
                                  onChange={(e) =>
                                    setSelected(
                                      e.target.checked
                                        ? [...selected, c.id]
                                        : selected.filter((id) => id !== c.id),
                                    )
                                  }
                                />
                              </td>
                              <td>
                                <strong>{c.description}</strong>
                                <small>{c.category}</small>
                                <CandidateEditor candidate={c} data={data} act={act}/>
                              </td>
                              <td>{dateLabel(c.date)}</td>
                              <td
                                className={
                                  c.kind === "income" ? "positive" : ""
                                }
                              >
                                {c.kind === "expense" ? "− " : "+ "}
                                {brl(c.amount)}
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    c.duplicate === "new"
                                      ? "green"
                                      : c.duplicate === "possible"
                                        ? "orange"
                                        : "neutral"
                                  }
                                >
                                  {c.duplicate === "new"
                                    ? "Novo"
                                    : c.duplicate === "possible"
                                      ? "Possível duplicidade"
                                      : "Já importado"}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="review-footer">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={confirmDistinct}
                          onChange={(e) => setConfirmDistinct(e.target.checked)}
                        />{" "}
                        Revisei as possíveis duplicidades selecionadas e
                        confirmo que são movimentos distintos.
                      </label>
                      <button
                        className="button primary"
                        disabled={busy || !selected.length}
                        onClick={async () => {
                          try {
                            const r = await act("import.commit", {
                              id: activeBatch,
                              selected,
                              confirmDistinct,
                            });
                            setNotice(
                              `${r.count ?? 0} lançamento(s) importado(s); ${r.skipped ?? 0} duplicado(s) ignorado(s).`,
                            );
                            setBatchId("");
                          } catch {}
                        }}
                      >
                        <Check size={17} /> Confirmar {selected.length}{" "}
                        registro(s)
                      </button>
                    </div>
                  </>
                ) : (
                  <Empty
                    icon={FileCheck2}
                    title="Nenhum registro aguardando revisão"
                    description="Importe um arquivo para conferir as movimentações extraídas."
                  />
                )}
              </section>
              {data.batches.some((b) => b.status === "committed") && (
                <p className="page-footnote">
                  {data.batches.filter((b) => b.status === "committed").length}{" "}
                  lote(s) confirmado(s). As referências de origem permanecem no
                  histórico.
                </p>
              )}
            </>
          )}
          {page === "forecast" && (
            <>
              <div className="section-toolbar">
                <span className="hint">
                  <TrendingUp size={17} /> Projeção determinística ·{" "}
                  {data.today.split("-").reverse().join("/")}
                </span>
                <select
                  aria-label="Horizonte"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  {[7, 30, 60, 90, 365].map((d) => (
                    <option key={d} value={d}>
                      {d === 365 ? "12 meses" : `${d} dias`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="projection-layout">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Saldo ao longo do tempo</h2>
                      <p>
                        Saldo final: <strong>{brl(ending)}</strong>
                      </p>
                    </div>
                    <Badge tone={risk ? "orange" : "green"}>
                      {risk ? "Há risco de caixa" : "Cenário cadastrado"}
                    </Badge>
                  </div>
                  <CashChart points={projection} />
                  <div className="projection-assumptions">
                    <h3>O que entra nesta conta</h3>
                    <p>
                      Saldo atual de {brl(balance)} + recebimentos abertos −
                      pagamentos abertos. Vencidos são considerados hoje.
                      Transferências internas não alteram o total.
                    </p>
                    <p>
                      Não inclui compromissos marcados como estimados, gastos variáveis não cadastrados, inflação,
                      reajustes ainda não informados ou retornos de
                      investimentos.
                    </p>
                  </div>
                </section>
                <section className="panel simulation">
                  <span className="eyebrow">E SE…</span>
                  <h2>Um gasto adicional coubesse no plano?</h2>
                  <p>Simule uma saída imediata, sem alterar seus registros.</p>
                  <Field label="Valor do gasto adicional (R$)">
                    <input
                      inputMode="decimal"
                      value={simulation}
                      onChange={(e) => setSimulation(e.target.value)}
                      placeholder="0,00"
                    />
                  </Field>
                  {(() => {
                    try {
                      const cost = simulation
                        ? cents(cleanMoney(simulation))
                        : 0n;
                      if (cost < 0n) throw new Error();
                      const simulated = decimal(cents(ending) - cost);
                      const lowest = decimal(
                        projection.reduce(
                          (m, p) =>
                            cents(p.balance) < m ? cents(p.balance) : m,
                          cents(balance),
                        ) - cost,
                      );
                      return (
                        <div className="simulation-result">
                          <span>Saldo final simulado</span>
                          <strong>{brl(simulated)}</strong>
                          <small>Menor saldo no período: {brl(lowest)}</small>
                        </div>
                      );
                    } catch {
                      return (
                        <p className="error">
                          Informe um valor positivo com até duas casas decimais.
                        </p>
                      );
                    }
                  })()}
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Memória de cálculo diária</h2>
                  <Badge>Valores previstos</Badge>
                </div>
                <div className="table-scroll forecast-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Entradas previstas</th>
                        <th>Saídas previstas</th>
                        <th className="align-right">Saldo projetado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projection.map((p) => (
                        <tr key={p.date}>
                          <td>{p.date.split("-").reverse().join("/")}</td>
                          <td className="positive">{brl(p.income)}</td>
                          <td>{brl(p.expense)}</td>
                          <td
                            className={`align-right amount ${cents(p.balance) < 0n ? "negative" : ""}`}
                          >
                            {brl(p.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {page === "settings" && (
            <>
              <div className="settings-grid">
                <InstallPanel/>
                <SessionPanel/>
                <BackupPanel/>
                <InvitePanel/>
                <CategoryPanel custom={data.categories} act={act}/>
                <section className="panel settings-card">
                  <ShieldCheck size={26} />
                  <h2>Sobre esta instalação</h2>
                  <dl>
                    <div>
                      <dt>Perfil</dt>
                      <dd>{auth.user.name}</dd>
                    </div>
                    <div>
                      <dt>E-mail</dt>
                      <dd>{auth.user.email}</dd>
                    </div>
                    <div>
                      <dt>Persistência</dt>
                      <dd>
                        {data.storage === "local"
                          ? "PostgreSQL embarcado · local"
                          : "PostgreSQL dedicado"}
                      </dd>
                    </div>
                    <div>
                      <dt>Moeda / fuso</dt>
                      <dd>BRL · America/Sao_Paulo</dd>
                    </div>
                  </dl>
                  <p>
                    Os dados estruturados persistem no servidor desta instalação. PDFs, imagens e textos lidos não são mantidos. O navegador
                    guarda somente a sessão de acesso.
                  </p>
                </section>
                <section className="panel settings-card">
                  <Activity size={26} />
                  <h2>Recursos disponíveis e evolução</h2>
                  <p>
                    Contas, caixa, compromissos, contratos recorrentes, leitura temporária de documentos,
                    conciliação, projeções, backup criptografado e auditoria estão disponíveis.
                  </p>
                  <p>
                    Próximas etapas: cartões e faturas consolidadas, simulação de renegociação de dívidas,
                    orçamentos, metas, MFA e consultor IA conectado a provedor.
                  </p>
                  <p>
                    Gmail e outros conectores exigirão integração própria e
                    autorização. Nenhuma caixa de e-mail é lida nesta versão.
                  </p>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Histórico de operações</h2>
                    <p>
                      Últimos 50 eventos. Nenhuma operação de apagar histórico é
                      exposta.
                    </p>
                  </div>
                  <ShieldCheck size={18} />
                </div>
                {data.audit.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Operação</th>
                          <th>Data e hora</th>
                          <th>Referência</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((a) => (
                          <tr key={a.id}>
                            <td>
                              {(
                                {
                                  "account.create": "Conta cadastrada",
                                  "movement.created": "Lançamento criado",
                                  "movement.reverse": "Lançamento estornado",
                                  "obligation.create": "Compromisso cadastrado",
                                  "obligation.settle": "Compromisso liquidado",
                                  "obligation.cancel": "Compromisso cancelado",
                                  "contract.create": "Contrato cadastrado",
                                  "import.stage": "Importação recebida",
                                  "import.commit": "Importação confirmada",
                                } as Record<string, string>
                              )[a.action] || a.action}
                            </td>
                            <td>
                              {new Date(a.created_at).toLocaleString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                              })}
                            </td>
                            <td>
                              <code>{a.id.slice(0, 8)}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={ShieldCheck}
                    title="Seu histórico começa aqui"
                    description="As próximas alterações ficarão registradas nesta área."
                  />
                )}
              </section>
            </>
          )}
          <footer className="page-footer">
            <span>
              <Activity size={14} /> Finance Intelligence
            </span>
            <span>Organizar. Compreender. Planejar.</span>
          </footer>
        </div>
      </main>
      {modal && (
        <dialog className="modal" ref={dialog} onCancel={() => setModal(null)}>
          <div className="modal-heading">
            <div>
              <span className="eyebrow">SUA BASE FINANCEIRA</span>
              <h2>{modalTitle[modal]}</h2>
            </div>
            <button
              className="icon-button"
              aria-label="Fechar formulário"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              <X size={21} />
            </button>
          </div>
          {modal === "categorize" ? (
            (() => {
              const t = data.transactions.find((x) => x.id === target);
              return t ? (
                <MovementCategoryEditor
                  movement={t}
                  splits={data.splits.filter((s) => s.transaction_id === t.id)}
                  act={act}
                  onClose={() => setModal(null)}
                />
              ) : null;
            })()
          ) : (
          <form onSubmit={submitModal}>
            {modal === "account" && (
              <>
                <Field label="Nome da conta">
                  <input
                    name="name"
                    required
                    maxLength={120}
                    placeholder="Ex.: Conta principal"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Instituição">
                    <input
                      name="institution"
                      maxLength={120}
                      placeholder="Banco ou instituição"
                    />
                  </Field>
                  <Field label="Tipo">
                    <select
                      name="type"
                      value={accountType}
                      onChange={(e) => setAccountType(e.target.value)}
                    >
                      <option value="checking">Conta corrente</option>
                      <option value="savings">Poupança</option>
                      <option value="cash">Dinheiro</option>
                      <option value="investment">Investimento</option>
                      <option value="credit_card">Cartão de crédito</option>
                    </select>
                  </Field>
                  <Field
                    label={
                      accountType === "credit_card"
                        ? "Fatura já em aberto (R$, negativo)"
                        : "Saldo inicial (R$)"
                    }
                  >
                    <Amount
                      name="opening_balance"
                      defaultValue="0,00"
                      negative
                    />
                  </Field>
                  <Field label="Data de referência">
                    <input
                      name="opening_date"
                      type="date"
                      defaultValue={data.today}
                      max={data.today}
                      required
                    />
                  </Field>
                </div>
                {accountType === "credit_card" && <CardFields />}
                <p className="form-help">
                  {accountType === "credit_card"
                    ? "Compras entram como despesas do cartão. O pagamento da fatura é uma transferência da sua conta para o cartão, para não contar o mesmo gasto duas vezes. Compras anteriores à data de referência não podem ser lançadas neste cartão."
                    : "Use o saldo no início do dia, antes dos movimentos que serão registrados nessa data."}
                </p>
              </>
            )}
            {modal === "accountEdit" &&
              (() => {
                const a = data.accounts.find((x) => x.id === target);
                if (!a) return null;
                return (
                  <>
                    <Field label={isCard(a) ? "Nome do cartão" : "Nome da conta"}>
                      <input name="name" required maxLength={120} defaultValue={a.name} />
                    </Field>
                    <Field label="Instituição">
                      <input name="institution" maxLength={120} defaultValue={a.institution} />
                    </Field>
                    {isCard(a) && <CardFields values={a} />}
                    <p className="form-help">
                      Saldo inicial e data de referência não mudam aqui, para preservar o histórico.
                    </p>
                  </>
                );
              })()}
            {modal === "movement" && (
              <>
                <Field label="Tipo de movimento">
                  <select
                    name="kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="expense">Despesa paga</option>
                    <option value="income">Receita recebida</option>
                    <option value="transfer">
                      Transferência entre contas próprias
                    </option>
                  </select>
                </Field>
                <Field label="Descrição">
                  <input
                    name="description"
                    required
                    maxLength={300}
                    placeholder="O que aconteceu?"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Valor (R$)">
                    <Amount />
                  </Field>
                  <Field
                    label={kind === "transfer" ? "Conta de origem" : "Conta"}
                  >
                    <select name="account_id" required>
                      <option value="">Selecione</option>
                      {options}
                    </select>
                  </Field>
                  {kind === "transfer" ? (
                    <Field label="Conta de destino">
                      <select name="destination_account_id" required defaultValue={transferTo} key={transferTo}>
                        <option value="">Selecione</option>
                        {options}
                      </select>
                    </Field>
                  ) : (
                    <Category />
                  )}
                  <Field label="Data de liquidação">
                    <input
                      name="date"
                      type="date"
                      defaultValue={data.today}
                      max={data.today}
                      required
                    />
                  </Field>
                  <Field label="Data de competência">
                    <input
                      name="competence"
                      type="date"
                      defaultValue={data.today}
                      required
                    />
                  </Field>
                </div>
                {kind === "transfer" && (
                  <input
                    type="hidden"
                    name="category"
                    value="Transferência interna"
                  />
                )}
                {!data.accounts.length && (
                  <p className="error">
                    Cadastre uma conta antes de criar lançamentos.
                  </p>
                )}
                <p className="form-help">
                  Registre somente movimentos já realizados. Para datas futuras,
                  utilize Compromissos.
                </p>
              </>
            )}
            {modal === "obligation" && (
              <>
                <Field label="Descrição">
                  <input
                    name="description"
                    required
                    maxLength={300}
                    placeholder="Ex.: Conta de internet"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Tipo">
                    <select name="kind">
                      <option value="expense">A pagar</option>
                      <option value="income">A receber</option>
                    </select>
                  </Field>
                  <Field label="Valor (R$)">
                    <Amount />
                  </Field>
                  <Field label="Vencimento">
                    <input
                      name="due_date"
                      type="date"
                      defaultValue={data.today}
                      required
                    />
                  </Field>
                  <Category />
                </div>
                <p className="form-help">
                  Este registro afeta a projeção. O saldo atual muda apenas
                  quando você liquidar o compromisso.
                </p>
              </>
            )}
            {modal === "contract" && (
              <>
                <ContractTerms/>
                <Field label="Título do contrato">
                  <input
                    name="title"
                    required
                    maxLength={300}
                    placeholder="Ex.: Aluguel residencial"
                  />
                </Field>
                <Field label="Contraparte / fornecedor">
                  <input
                    name="counterparty"
                    required
                    maxLength={300}
                    placeholder="Nome da pessoa ou empresa"
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Valor mensal (R$)">
                    <Amount />
                  </Field>
                  <Category />
                  <Field label="Data de início">
                    <input
                      name="start_date"
                      type="date"
                      defaultValue={data.today}
                      required
                    />
                  </Field>
                  <Field label="Dia de vencimento">
                    <input
                      name="due_day"
                      type="number"
                      min="1"
                      max="31"
                      defaultValue="10"
                      required
                    />
                  </Field>
                  <Field label="Quantidade de vencimentos">
                    <input
                      name="months"
                      type="number"
                      min="1"
                      max="60"
                      defaultValue="12"
                      required
                    />
                  </Field>
                </div>
                <div className="form-grid">
                  <Field label="Valor contratado (R$), se informado"><input name="total_amount" inputMode="decimal"/></Field>
                  <Field label="Fim da vigência, se informado"><input name="end_date" type="date"/></Field>
                  <Field label="Renovação, se informada"><input name="renewal_date" type="date"/></Field>
                  <Field label="Juros (%), se informados"><input name="interest_rate" inputMode="decimal"/></Field>
                  <Field label="CET (%), se informado"><input name="cet" inputMode="decimal"/></Field>
                </div>
                <Field label="Multas e encargos (resumo)"><textarea name="penalty_note" maxLength={500}/></Field>
                <label className="checkbox-label"><input name="confirm_distinct" type="checkbox"/> Confirmo que este contrato é distinto de contratos semelhantes.</label>
                <Field label="Observações sobre reajuste (opcional)">
                  <textarea
                    name="adjustment_note"
                    maxLength={1000}
                    placeholder="Índice e data previstos no contrato. Não há aplicação automática."
                  />
                </Field>
                <p className="form-help">
                  Ao salvar, você confirma as condições e autoriza a geração das
                  ocorrências. Dias inexistentes passam para o último dia do
                  mês; a primeira ocorrência será em ou após o início.
                </p>
              </>
            )}
            {modal === "settle" && (
              <>
                <div className="settle-summary">
                  <strong>
                    {data.obligations.find((o) => o.id === target)?.description}
                  </strong>
                  <span>
                    {brl(
                      data.obligations.find((o) => o.id === target)?.amount ||
                        "0",
                    )}
                  </span>
                </div>
                <Field label="Como liquidar?">
                  <select
                    value={settlementId}
                    onChange={(e) => setSettlementId(e.target.value)}
                  >
                    <option value="">
                      Registrar um novo pagamento / recebimento
                    </option>
                    {data.transactions
                      .filter(
                        (t) =>
                          t.status === "posted" &&
                          t.kind ===
                            data.obligations.find((o) => o.id === target)
                              ?.kind &&
                          t.amount ===
                            data.obligations.find((o) => o.id === target)
                              ?.amount &&
                          !data.obligations.some(
                            (o) => o.settled_transaction_id === t.id,
                          ),
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          Vincular: {t.description} · {dateLabel(t.date)} ·{" "}
                          {accountName(t.account_id)}
                        </option>
                      ))}
                  </select>
                </Field>
                {!settlementId && (
                  <>
                    <Field label="Conta de liquidação">
                      <select name="account_id" required>
                        <option value="">Selecione</option>
                        {options}
                      </select>
                    </Field>
                    <Field label="Data do pagamento / recebimento">
                      <input
                        type="date"
                        name="date"
                        defaultValue={data.today}
                        max={data.today}
                        required
                      />
                    </Field>
                  </>
                )}
                <p className="form-help">
                  Vincule um movimento existente para evitar duplicação. Somente
                  registros com o mesmo valor e tipo, ainda não vinculados a
                  outro compromisso, aparecem na lista. Um novo pagamento gera
                  uma única movimentação pelo valor integral.
                </p>
              </>
            )}
            {modal === "reverse" && (
              <>
                <p className="form-help">
                  O lançamento sairá do cálculo de saldo. O registro original e
                  o motivo serão preservados. Compromissos vinculados voltarão a
                  ficar em aberto.
                </p>
                <Field label="Motivo do estorno">
                  <textarea
                    name="reason"
                    required
                    minLength={5}
                    maxLength={300}
                    placeholder="Explique a correção"
                  />
                </Field>
              </>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={
                  busy ||
                  (["movement", "settle"].includes(modal) &&
                    !data.accounts.length)
                }
              >
                {busy
                  ? "Salvando…"
                  : modal === "reverse"
                    ? "Confirmar estorno"
                    : modal === "settle"
                      ? "Confirmar liquidação"
                      : "Salvar e confirmar"}
                <Check size={16} />
              </button>
            </div>
          </form>
          )}
        </dialog>
      )}
    </div>
  );
}
