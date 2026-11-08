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
  BarChart3,
  Users,
} from "lucide-react";
import { brl, cents, decimal, localToday } from "@/lib/money";
import { cardBillSchedule, categoryBreakdown, forecast, isCard, isLiquid, nextDueDate, totals, type CategoryGroupTotal } from "@/lib/finance";
import { lastMonths } from "@/lib/planning";
import { transactionsCsv } from "@/lib/planning";
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
import ReportsPage from "./reports-page";
import SharedPage, { JoinGroupCard, clearGroupInvite, fetchInvitePreview, readGroupInvite, type InvitePreview } from "./shared-page";
import SheetImport from "./sheet-import";
import ReceiptImport from "./receipt-import";
import { CardFields, accountLabel, accountTypeLabel } from "./card-fields";
import { categoryList, DIVIDED } from "@/lib/categorize";
import CategorySelect, { CategoryOptions } from "./category-select";
import CountUp from "./count-up";
import AdvisorPage from "./advisor-page";
import { ForgotPassword, ResetPassword, readResetToken } from "./password-reset";
import { obligationStage } from "@/lib/intake";

type Page =
  | "overview"
  | "transactions"
  | "accounts"
  | "obligations"
  | "contracts"
  | "loans"
  | "reports"
  | "shared"
  | "imports"
  | "forecast"
  | "advisor"
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
  { id: "overview", label: "Visão geral", short: "Início", icon: LayoutDashboard, group: "" },
  { id: "transactions", label: "Movimentações", short: "Movimentos", icon: ArrowRightLeft, group: "" },
  { id: "accounts", label: "Contas e cartões", short: "Contas", icon: Wallet, group: "" },
  { id: "imports", label: "Importar", short: "Importar", icon: Upload, group: "" },
  { id: "advisor", label: "Consultor IA", short: "Consultor", icon: Sparkles, group: "" },
  { id: "obligations", label: "Compromissos", short: "Agenda", icon: CalendarDays, group: "Planejamento" },
  { id: "forecast", label: "Projeção de caixa", short: "Projeção", icon: TrendingUp, group: "Planejamento" },
  { id: "reports", label: "Orçamentos e metas", short: "Metas", icon: BarChart3, group: "Planejamento" },
  { id: "contracts", label: "Contratos", short: "Contratos", icon: FileText, group: "Planejamento" },
  { id: "loans", label: "Empréstimos e dívidas", short: "Dívidas", icon: HandCoins, group: "Planejamento" },
  { id: "shared", label: "Dividir despesas", short: "Dividir", icon: Users, group: "Pessoas" },
] as const;
/** Destinos da barra inferior no celular; o restante fica em "Mais". */
const bottomNav: Page[] = ["overview", "transactions", "accounts", "imports"];
const pageSlug: Record<Page, string> = {
  overview: "visao-geral", transactions: "movimentacoes", accounts: "contas", obligations: "compromissos",
  contracts: "contratos", loans: "emprestimos", reports: "orcamentos", shared: "dividir",
  imports: "importar", forecast: "projecao", advisor: "consultor", settings: "configuracoes",
};
const pageFromHash = (hash: string): Page | null =>
  (Object.keys(pageSlug) as Page[]).find((k) => `#/${pageSlug[k]}` === hash) || null;
const pageText: Record<Page, { title: string; subtitle: string }> = {
  overview: { title: "Visão geral", subtitle: "" },
  transactions: { title: "Movimentações", subtitle: "Entradas, saídas e transferências." },
  accounts: { title: "Contas e cartões", subtitle: "Saldos a partir do valor inicial que você informou." },
  obligations: { title: "Compromissos", subtitle: "Contas a pagar e a receber." },
  contracts: { title: "Contratos", subtitle: "Condições recorrentes que geram compromissos." },
  loans: { title: "Empréstimos e dívidas", subtitle: "Com pessoas ou bancos, parcela por parcela." },
  shared: { title: "Dividir despesas", subtitle: "Cada pessoa vê só a própria parte nas finanças." },
  reports: { title: "Orçamentos e metas", subtitle: "Limites por categoria, metas e comparação mensal." },
  imports: { title: "Importar", subtitle: "Tudo passa por revisão antes de entrar no saldo." },
  forecast: { title: "Projeção de caixa", subtitle: "Com base em saldos e compromissos cadastrados." },
  advisor: { title: "Consultor IA", subtitle: "Perguntas e simulações com base nos seus registros." },
  settings: { title: "Configurações", subtitle: "" },
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
    throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo. Antes de repetir um cadastro, atualize a página e confira se ele já foi salvo.");
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
/** Categoria em duas listas (grupo e subcategoria), com opção de incluir uma nova. */
function Category() {
  return <CategorySelect name="category" defaultValue="Sem categoria" required />;
}
const slugify = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const lastDay = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};
/** Único ponto de exportação de movimentações: período (padrão = mês filtrado) + filtros da tela. */
function ExportMenu({ month, note, onExport }: { month: string; note: string; onExport: (from: string, to: string) => void }) {
  const [from, setFrom] = useState(`${month}-01`), [to, setTo] = useState(lastDay(month));
  useEffect(() => { setFrom(`${month}-01`); setTo(lastDay(month)); }, [month]);
  return (
    <details className="export-menu">
      <summary className="button"><ArrowDownToLine size={16} /> Exportar</summary>
      <div className="export-pop">
        <strong>Exportar movimentações (CSV)</strong>
        <div className="export-dates">
          <label className="field"><span>De</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>Até</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <small>{note ? `Filtros aplicados: ${note}. ` : ""}Compras divididas saem uma linha por categoria. Abre no Excel.</small>
        <button type="button" className="button primary" disabled={!from || !to || from > to} onClick={() => onExport(from, to)}>
          <ArrowDownToLine size={16} /> Baixar CSV
        </button>
      </div>
    </details>
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
            <stop offset="0%" stopColor="#FFD700" stopOpacity=".22" />
            <stop offset="100%" stopColor="#FFD700" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="64"
              x2="740"
              y1={40 + f * 150}
              y2={40 + f * 150}
              stroke="#333333"
              strokeDasharray="4 5"
            />
            <text x="0" y={44 + f * 150} fontSize="11" fill="#A9A39A">
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
            stroke="#F28B82"
            strokeDasharray="4 4"
          />
        )}
        <path
          d={line}
          fill="none"
          stroke="#FFD700"
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
              fill="#A9A39A"
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
          fill="#FFD700"
          stroke="#1A1A1A"
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
  groupInvite = "",
}: {
  needsSetup: boolean;
  requiresSetupToken: boolean;
  onDone: () => Promise<void>;
  groupInvite?: string;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [registering, setRegistering] = useState(false);
  const [invite, setInvite] = useState<InvitePreview | null>(null),
    [inviteError, setInviteError] = useState("");
  const [recover, setRecover] = useState<"" | "forgot" | "reset">(""),
    [resetTokenValue, setResetTokenValue] = useState(""),
    [loginNotice, setLoginNotice] = useState("");
  useEffect(() => {
    const check = () => {
      const t = readResetToken();
      if (t) { setResetTokenValue(t); setRecover("reset"); }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  useEffect(() => {
    if (groupInvite) fetchInvitePreview(groupInvite).then((p) => { setInvite(p); setRegistering(true); }).catch((e) => setInviteError(e.message));
  }, [groupInvite]);
  // Com link de grupo válido, "criar acesso" cria conta só para dividir (sem código de convite).
  const splitSignup = registering && !!invite;
  const creating = needsSetup || registering;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await request("/api/auth", {
        action: needsSetup ? "setup" : splitSignup ? "split" : registering ? "register" : "login",
        group_token: splitSignup ? groupInvite : undefined,
        claim_member_id: splitSignup ? form.get("claim_member_id") || undefined : undefined,
        name: form.get("name") || undefined,
        email: form.get("email"),
        password: form.get("password"),
        setup_token: form.get("setup_token") || undefined,
        invite_code: form.get("invite_code") || undefined,
      });
      if (splitSignup) clearGroupInvite();
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
          <h1>
            Suas finanças,
            <br />
            <em>em um só lugar.</em>
          </h1>
          <p>Saldos, cartões, compromissos e projeções com base no que você registra.</p>
          <div className="login-stats">
            <div><strong><CountUp value={4} format={(n) => String(Math.round(n))} duration={900} /></strong><span>formatos: PDF, print, planilha e extrato</span></div>
            <div><strong><CountUp value={100} format={(n) => `${Math.round(n)}%`} duration={900} /></strong><span>revisado por você antes de salvar</span></div>
            <div><strong><CountUp value={0} format={(n) => String(Math.round(n))} /></strong><span>arquivos guardados após a leitura</span></div>
          </div>
        </div>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          {recover === "forgot" ? (
            <ForgotPassword onBack={() => setRecover("")} />
          ) : recover === "reset" ? (
            <ResetPassword token={resetTokenValue} onDone={(m) => { setRecover(""); setResetTokenValue(""); setLoginNotice(m); }} />
          ) : (<>
          <h2>
            {needsSetup
              ? "Criar acesso"
              : registering
                ? "Criar acesso"
                : "Entrar"}
          </h2>
          <p>
            {needsSetup
              ? "Crie o seu acesso pessoal."
              : registering
                ? splitSignup
                  ? "Crie um acesso só para dividir despesas. Você pode virar conta completa depois, por convite."
                  : "Use o convite que você recebeu. Seus dados ficam separados dos de quem convidou."
                : "Use seu e-mail e senha."}
          </p>
          {invite && (
            <p className="login-invite">
              <strong>{invite.inviter}</strong> convidou você para o grupo <strong>{invite.group_name}</strong>. Entre ou crie um acesso para participar.
            </p>
          )}
          {inviteError && <p className="error">{inviteError}</p>}
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
                {invite ? "Criar acesso" : "Tenho um convite"}
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
            {splitSignup && invite.guests.length > 0 && (
              <Field label="Você já está no grupo com outro nome?">
                <select name="claim_member_id" defaultValue="">
                  <option value="">Não</option>
                  {invite.guests.map((g) => <option key={g.id} value={g.id}>Sou {g.name}</option>)}
                </select>
              </Field>
            )}
            {registering && !needsSetup && !splitSignup && (
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
            {loginNotice && !error && <p role="status" className="login-notice">{loginNotice}</p>}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy
                ? "Preparando seu espaço…"
                : creating
                  ? "Criar acesso"
                  : "Entrar"}
              <ArrowRight size={17} />
            </button>
          </form>
          {!creating && (
            <button type="button" className="text-button forgot-link" onClick={() => { setError(""); setLoginNotice(""); setRecover("forgot"); }}>
              Esqueci minha senha
            </button>
          )}
          </>)}
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
    user: { id: string; name: string; email: string; plan?: string } | null;
  } | null>(null);
  const [groupInvite, setGroupInvite] = useState("");
  useEffect(() => setGroupInvite(readGroupInvite()), []);
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
  const [catMonths, setCatMonths] = useState(3);
  const [importTab, setImportTab] = useState<"document" | "sheet" | "statement" | "receipt">("document");
  const [days, setDays] = useState(30),
    [simulation, setSimulation] = useState(""),
    [batchId, setBatchId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [confirmDistinct, setConfirmDistinct] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    const session = await request<NonNullable<typeof auth>>("/api/auth");
    setAuth(session);
    if (session.user?.plan === "split_only") setPage("shared");
    if (session.user) setData(await request<FinanceState>("/api/finance"));
    else setData(null);
  }, []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else setError(""); // erro do formulário não deve sobrar após fechá-lo
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
    if (window.location.hash !== `#/${pageSlug[id]}`) window.history.pushState(null, "", `#/${pageSlug[id]}`);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const sync = () => { const p = pageFromHash(window.location.hash); if (p) setPage(p); };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
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
  // Envio idêntico ainda em andamento (duplo clique/toque) reaproveita a mesma requisição.
  const inFlight = useRef(new Map<string, Promise<{ id: string; count?: number; skipped?: number }>>());
  function act(action: string, payload: unknown, message = "Alteração salva.") {
    const key = JSON.stringify([action, payload]);
    const pending = inFlight.current.get(key);
    if (pending) return pending;
    const run = actOnce(action, payload, message).finally(() => inFlight.current.delete(key));
    inFlight.current.set(key, run);
    return run;
  }
  async function actOnce(
    action: string,
    payload: unknown,
    message: string,
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
  if (!auth.user) return <Login needsSetup={auth.needsSetup} requiresSetupToken={auth.requiresSetupToken} onDone={async () => { setError(""); await load(); setGroupInvite(readGroupInvite()); }} groupInvite={groupInvite} />;
  const splitOnly = auth.user.plan === "split_only";
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
  const bankAccounts = data.accounts.filter(isLiquid);
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
  // Faturas de cartão como compromissos: vencidas (não pagas) e próximas.
  const bills = cardBillSchedule(data.accounts, data.transactions, data.today).filter((b) => b.kind !== "installment");
  const overdueBills = bills.filter((b) => b.overdue);
  type Upcoming = { key: string; date: string; title: string; detail: string; amount: string; income: boolean; overdue: boolean; cardId?: string; obligationId?: string };
  const upcoming: Upcoming[] = [
    ...bills.map((b) => ({ key: `bill-${b.accountId}-${b.kind}`, date: b.dueDate, title: `Fatura ${b.name}`, detail: b.overdue ? "Fatura vencida e não paga" : b.kind === "open" ? "Fatura aberta" : "Fatura fechada", amount: decimal(b.amount), income: false, overdue: b.overdue, cardId: b.accountId })),
    ...openObligations.map((o) => ({ key: o.id, date: o.due_date, title: o.description, detail: o.category, amount: o.amount, income: o.kind === "income", overdue: o.due_date < data.today, obligationId: o.id })),
  ].sort((a, b) => (a.overdue === b.overdue ? a.date.localeCompare(b.date) : a.overdue ? -1 : 1));
  const overdueTotal = upcoming.filter((u) => u.overdue && !u.income).reduce((n, u) => n + cents(u.amount), 0n);
  const pendingReview = data.batches.some((b) => b.status === "review");
  // Conta "só divisão" fica sempre em Dividir, mesmo se o endereço (#/...) apontar outra tela.
  if (splitOnly && page !== "shared") setPage("shared");
  const risk = projection.find((p) => cents(p.balance) < 0n);
  const filtered = data.transactions.filter(
    (t) =>
      t.date.startsWith(month) &&
      (!accountFilter ||
        t.account_id === accountFilter ||
        t.destination_account_id === accountFilter) &&
      `${t.description} ${t.category}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const allSplits = data.splits;
  const accountName = (id: string) =>
    data.accounts.find((a) => a.id === id)?.name || "Conta";
  const options = data.accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {accountLabel(a)}
    </option>
  ));
  const filteredForExport = data.transactions.filter(
    (t) =>
      (!accountFilter || t.account_id === accountFilter || t.destination_account_id === accountFilter) &&
      `${t.description} ${t.category}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  // Por grupo (Alimentação, Casa…) com subcategorias; lançamentos divididos entram pelas partes.
  // Despesas por categoria no período escolhido (mês atual ou últimos meses), terminando no mês filtrado.
  const categories = (() => {
    const merged = new Map<string, Map<string, bigint>>();
    for (const m of lastMonths(month, catMonths))
      for (const g of categoryBreakdown(data.transactions, data.splits, m)) {
        const subs = merged.get(g.group) || new Map<string, bigint>();
        for (const sub of g.subs) subs.set(sub.name, (subs.get(sub.name) || 0n) + sub.total);
        merged.set(g.group, subs);
      }
    return [...merged.entries()]
      .map(([group, subs]): CategoryGroupTotal => ({ group, total: [...subs.values()].reduce((n, v) => n + v, 0n), subs: [...subs.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => (a.total > b.total ? -1 : 1)) }))
      .sort((a, b) => (a.total > b.total ? -1 : 1));
  })();
  const expenses = categories.reduce((n, c) => n + c.total, 0n);
  // Composição da projeção até o primeiro dia negativo (para o alerta explicar o número).
  const riskBreakdown = (() => {
    if (!risk) return null;
    const until = projection.filter((p) => p.date <= risk.date);
    const income = until.reduce((n, p) => n + cents(p.income), 0n), out = until.reduce((n, p) => n + cents(p.expense), 0n);
    const cardOut = cardBillSchedule(data.accounts, data.transactions, data.today).filter((b) => b.date <= risk.date).reduce((n, b) => n + b.amount, 0n);
    return { income, cardOut, otherOut: out - cardOut };
  })();
  const modalTitle = {
    account: "Adicionar conta",
    movement: "Nova movimentação",
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
        <table className="movement-table">
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
    <CategoryOptions.Provider value={allCategories}>
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Fechar menu"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside id="menu-lateral" className={`sidebar ${sidebar ? "shown" : ""}`}>
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
        <nav aria-label="Navegação principal">
          {navigation.filter((n) => !splitOnly || n.id === "shared").map(({ id, label, icon: Icon, group }, i, list) => (
            <div key={id} className="nav-item">
              {!splitOnly && group && list[i - 1]?.group !== group && <span className="nav-heading">{group}</span>}
              <button
                className={page === id ? "active" : ""}
                onClick={() => navigate(id)}
                aria-current={page === id ? "page" : undefined}
              >
                <Icon size={19} />
                {label}
                {id === "imports" && pendingReview && <><i className="nav-dot" /><span className="sr-only">(importação aguardando revisão)</span></>}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!splitOnly && <button
            className={`settings-link ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} /> Configurações
          </button>}
          <div className="profile">
            <span className="avatar">
              {auth.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              {auth.user.name}
              <small>{splitOnly ? "Só divisão de despesas" : "Conta pessoal"}</small>
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
              className={`mobile-menu icon-button ${splitOnly ? "" : "has-bottom-nav"}`}
              aria-label="Abrir menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <strong className="topbar-brand">Finance Intelligence</strong>
          </div>
          <div className="topbar-right">
            {!splitOnly && <button
              className="icon-button"
              aria-label={overdue.length ? `${overdue.length} compromisso(s) em atraso` : "Ver compromissos"}
              onClick={() => navigate("obligations")}
            >
              <Bell size={19} />
              {overdue.length > 0 && <i className="notification-dot" />}
            </button>}

          </div>
        </header>
        <div className="page-content">
          {groupInvite && <JoinGroupCard token={groupInvite} act={act} onDone={() => { setGroupInvite(""); navigate("shared"); }} />}
          <div className="page-heading">
            <div>
              {page === "overview" && <span className="eyebrow">Olá, {auth.user.name.split(" ")[0]}</span>}
              <h1>{pageText[page].title}</h1>
              {pageText[page].subtitle && <p>{pageText[page].subtitle}</p>}
            </div>
            {["overview", "transactions"].includes(page) && (
              <button
                className="button primary"
                onClick={() => open("movement")}
              >
                <Plus size={17} /> Nova movimentação
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
                    <strong>Comece cadastrando uma conta</strong>
                    <p>Informe o saldo atual para os cálculos começarem.</p>
                  </div>
                  <button className="button" onClick={() => open("account")}>
                    Adicionar conta <ArrowRight size={16} />
                  </button>
                </div>
              )}
              {(risk || overdue.length > 0 || overdueBills.length > 0) && (
                <div className="alerts">
                  {overdueBills.map((b) => (
                    <div key={b.accountId} className="alert danger">
                      <CreditCard size={17} />
                      <span><strong>Fatura {b.name} vencida</strong> {brl(decimal(b.amount))} venceu em {dateLabel(b.dueDate)} e não tem pagamento registrado.{b.estimated ? " Fechamento estimado: informe o dia de fechamento no cartão para mais precisão." : ""}</span>
                      <button className="button primary" onClick={() => payCard(b.accountId)}>Registrar pagamento</button>
                    </div>
                  ))}
                  {overdue.length > 0 && (
                    <button className="alert warning" onClick={() => navigate("obligations")}>
                      <CalendarDays size={17} />
                      <span><strong>{overdue.length} compromisso(s) em atraso</strong> Entram no primeiro dia da projeção.</span>
                      <ArrowRight size={15} />
                    </button>
                  )}
                  {risk && riskBreakdown && (
                    <details className="alert warning alert-details">
                      <summary>
                        <Bell size={17} />
                        <span><strong>Saldo previsto negativo</strong> {brl(risk.balance)} em {dateLabel(risk.date)}. Ver a conta</span>
                      </summary>
                      <ul className="alert-math">
                        <li><span>Saldo hoje nas contas</span><strong>{brl(balance)}</strong></li>
                        {riskBreakdown.income > 0n && <li><span>+ Entradas previstas até {dateLabel(risk.date)}</span><strong className="positive">{brl(decimal(riskBreakdown.income))}</strong></li>}
                        {riskBreakdown.cardOut > 0n && <li><span>− Faturas de cartão (vencidas entram hoje)</span><strong>{brl(decimal(riskBreakdown.cardOut))}</strong></li>}
                        {riskBreakdown.otherOut > 0n && <li><span>− Outros compromissos a pagar</span><strong>{brl(decimal(riskBreakdown.otherOut))}</strong></li>}
                        <li className="total"><span>= Saldo previsto em {dateLabel(risk.date)}</span><strong className="negative">{brl(risk.balance)}</strong></li>
                      </ul>
                      <p className="form-help">Considera só o que está cadastrado. Se o saldo das contas estiver desatualizado, corrija em Contas e cartões; se uma fatura já foi paga, registre o pagamento.</p>
                      <div className="row-actions"><button className="text-button" onClick={() => navigate("forecast")}>Ver projeção dia a dia <ArrowRight size={14} /></button></div>
                    </details>
                  )}
                </div>
              )}
              <div className="metrics">
                <div className="metric featured">
                  <div className="metric-label">
                    Saldo em contas <Wallet size={18} />
                  </div>
                  <strong><CountUp value={Number(balance)} format={brl} /></strong>
                  <span>
                    {bankAccounts.length}{" "}
                    {bankAccounts.length === 1 ? "conta" : "contas"} · hoje
                    {cards.length > 0 &&
                      ` · faturas em aberto: ${brl(cardDebt)}`}
                  </span>
                  <div className="metric-decoration" />
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Receitas do mês{" "}
                    <span className="metric-icon green">
                      <ArrowDownLeft size={17} />
                    </span>
                  </div>
                  <strong><CountUp value={Number(sum.income)} format={brl} /></strong>
                  <span>
                    <i className="dot green" /> Realizado
                  </span>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Despesas do mês{" "}
                    <span className="metric-icon orange">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                  <strong><CountUp value={Number(sum.expense)} format={brl} /></strong>
                  <span>
                    <i className="dot orange" /> Realizado
                  </span>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Previsto em {days} dias <TrendingUp size={18} />
                  </div>
                  <strong className={cents(ending) < 0n ? "negative" : ""}>
                    <CountUp value={Number(ending)} format={brl} />
                  </strong>
                  <span>
                    <i className="dot neutral" /> Previsto · só compromissos cadastrados
                  </span>
                </div>
              </div>
              <div className="dashboard-grid">
                <section className="panel forecast-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Saldo previsto</h2>
                      <p>A partir de hoje · <button className="text-button" onClick={() => navigate("forecast")}>Ver detalhes</button></p>
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
                      title="Sem dados para projetar"
                      description="Cadastre uma conta e seus próximos pagamentos e recebimentos."
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Compromissos e faturas</h2>
                      {overdueTotal > 0n && <p className="negative">Em atraso: {brl(decimal(overdueTotal))}</p>}
                    </div>
                    <button className="text-button" onClick={() => navigate("obligations")}>
                      Ver todos <ArrowRight size={14} />
                    </button>
                  </div>
                  {upcoming.length ? (
                    <div className="commitment-list">
                      {upcoming.slice(0, 6).map((u) => (
                        <div className={`commitment-row ${u.overdue ? "is-overdue" : ""}`} key={u.key}>
                          <div className="date-tile">
                            <strong>{u.date.slice(8)}</strong>
                            <span>{new Date(u.date + "T12:00:00Z").toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "")}</span>
                          </div>
                          <div className="grow">
                            <strong>{u.title}</strong>
                            <small>{u.overdue ? <span className="negative">Atrasado · </span> : null}{u.detail}</small>
                          </div>
                          <div className="commitment-side">
                            <strong className={u.income ? "positive" : u.overdue ? "negative" : ""}>{brl(u.amount)}</strong>
                            {u.cardId && <button className="text-button" onClick={() => payCard(u.cardId!)}>Pagar</button>}
                            {u.obligationId && <button className="text-button" onClick={() => open("settle", u.obligationId)}>{u.income ? "Recebi" : "Paguei"}</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={CalendarDays}
                      title="Nenhum vencimento cadastrado"
                      description="Organize suas próximas contas e receitas."
                      action={<button className="text-button" onClick={() => open("obligation")}>Adicionar compromisso <Plus size={14} /></button>}
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Despesas por categoria</h2>
                      <p>{brl(decimal(expenses))} · toque para ver as subcategorias</p>
                    </div>
                    <select aria-label="Período das despesas por categoria" value={catMonths} onChange={(e) => setCatMonths(Number(e.target.value))}>
                      <option value={1}>Mês selecionado</option>
                      <option value={3}>Últimos 3 meses</option>
                      <option value={6}>Últimos 6 meses</option>
                    </select>

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
                      title="Nenhuma despesa no período"
                      description="As despesas realizadas aparecem aqui por categoria."
                    />
                  )}
                </section>
              </div>
              <section className="panel transactions-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Últimas movimentações</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("transactions")}
                  >
                    Ver todas <ArrowRight size={14} />
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
                <ExportMenu
                  month={month}
                  onExport={(from, to) =>
                    downloadText(
                      transactionsCsv(filteredForExport, data.splits, data.accounts, from, to),
                      `movimentacoes-${from}-a-${to}${accountFilter ? "-" + slugify(accountName(accountFilter)) : ""}.csv`,
                    )
                  }
                  note={[accountFilter && `conta ${accountName(accountFilter)}`, search && `busca “${search}”`].filter(Boolean).join(" · ")}
                />
              </div>
              <MovementTable rows={filtered} />
              <div className="table-footer">
                {filtered.length} registro(s) · transferências não contam como
                receita nem despesa.
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
          {page === "reports" && <ReportsPage data={data} act={act} />}
          {page === "shared" && <SharedPage data={data} act={act} />}
          {page === "advisor" && <AdvisorPage />}
          {page === "loans" && (
            <LoansPage data={data} act={act} onPay={(id) => open("settle", id)} />
          )}
          {page === "imports" && (
            <>
              <div className="import-tabs" role="tablist" aria-label="Tipo de importação">
                {([
                  ["document", "PDF, print ou texto"],
                  ["sheet", "Planilha Excel"],
                  ["statement", "Extrato CSV/OFX"],
                  ["receipt", "Nota de mercado"],
                ] as const).map(([id, label]) => (
                  <button key={id} role="tab" id={`tab-${id}`} aria-controls={`painel-${id}`} aria-selected={importTab === id} className={importTab === id ? "active" : ""} onClick={() => setImportTab(id)}>
                    {label}
                    {id === "statement" && pendingReview && <><i className="nav-dot" /><span className="sr-only">(aguardando revisão)</span></>}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id="painel-document" aria-labelledby="tab-document" hidden={importTab !== "document"}><SourceIntake data={data} act={act}/></div>
              <div role="tabpanel" id="painel-sheet" aria-labelledby="tab-sheet" hidden={importTab !== "sheet"}><SheetImport data={data} act={act}/></div>
              <div role="tabpanel" id="painel-receipt" aria-labelledby="tab-receipt" hidden={importTab !== "receipt"}><ReceiptImport data={data} act={act}/></div>
              <section className="panel import-panel" role="tabpanel" id="painel-statement" aria-labelledby="tab-statement" hidden={importTab !== "statement"}>
                <div className="panel-heading">
                  <div>
                    <h2>Extrato do banco</h2>
                    <p>CSV ou OFX · até 2 MB</p>
                  </div>
                </div>
                <form onSubmit={importFile} className="padded-form">
                  <Field label="Conta do extrato">
                    <select name="account_id" required>
                      <option value="">Selecione a conta</option>
                      {options}
                    </select>
                  </Field>
                  <label className="field">
                    <span>Arquivo</span>
                    <input name="file" type="file" accept=".csv,.ofx" required aria-label="Arquivo CSV ou OFX" />
                  </label>
                  <button className="button primary" disabled={busy || !data.accounts.length}>
                    {busy ? "Lendo…" : "Ler extrato"}
                  </button>
                  {!data.accounts.length && (
                    <button type="button" className="text-button" onClick={() => open("account")}>
                      Cadastre uma conta primeiro
                    </button>
                  )}
                  <details className="help-details">
                    <summary>Formato do CSV e regras</summary>
                    <ul>
                      <li>Colunas: <code>data;descricao;valor;categoria</code>.</li>
                      <li>Data em DD/MM/AAAA ou AAAA-MM-DD. Saídas com valor negativo.</li>
                      <li>Desmarque transferências entre suas contas e pagamentos de fatura para não contar duas vezes.</li>
                      <li>O mesmo arquivo ou identificador OFX não gera lançamento repetido. Possíveis duplicidades pedem revisão.</li>
                    </ul>
                  </details>
                  <p className="form-help">O arquivo não é guardado. Itens não confirmados expiram em 24 horas.</p>
                </form>
              </section>
              {(importTab === "statement" || pendingReview) && (
              <section className="panel review-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Revisão do extrato</h2>
                    <p>Nada entra no saldo antes de você confirmar.</p>
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
              )}
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
                <section className="panel settings-card">
                  <ShieldCheck size={26} />
                  <h2>Sua conta</h2>
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
                  <p>PDFs, imagens e textos lidos não são guardados. O navegador guarda só a sessão de acesso.</p>
                </section>
                <BackupPanel/>
                <CategoryPanel custom={data.categories} act={act}/>
                <InvitePanel/>
                <SessionPanel/>
                <InstallPanel/>

              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Histórico de operações</h2>
                    <p>Últimos 50 eventos. O histórico não pode ser apagado.</p>
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

        </div>
      </main>
      {!splitOnly && (
        <nav className="bottom-nav" aria-label="Navegação rápida">
          {bottomNav.map((id) => {
            const item = navigation.find((n) => n.id === id)!;
            const Icon = item.icon;
            return (
              <button key={id} className={page === id ? "active" : ""} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}>
                <Icon size={20} />
                <span>{item.short}</span>
                {id === "imports" && pendingReview && <><i className="nav-dot" /><span className="sr-only">(importação aguardando revisão)</span></>}
              </button>
            );
          })}
          <button className={!bottomNav.includes(page) ? "active" : ""} aria-expanded={sidebar} aria-controls="menu-lateral" onClick={() => setSidebar(true)}>
            <Menu size={20} />
            <span>{bottomNav.includes(page) ? "Mais" : navigation.find((n) => n.id === page)?.short || "Mais"}</span>
          </button>
        </nav>
      )}
      {modal && (
        <dialog className="modal" ref={dialog} onCancel={() => setModal(null)}>
          <div className="modal-heading">
            <div>
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
    </CategoryOptions.Provider>
  );
}
