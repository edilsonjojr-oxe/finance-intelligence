'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Calculator, ShieldCheck, Sparkles } from 'lucide-react';

type Status = { configured: boolean; enabled: boolean; plan: string; used: number; limit: number };
type Step = { tool: string; input: unknown; summary: string };
type Turn = { role: 'user' | 'assistant'; text: string; steps?: Step[]; error?: boolean };

const SUGGESTIONS = [
  'Onde estou gastando mais este mês?',
  'Como fica meu saldo nos próximos 60 dias?',
  'Consigo comprar algo de R$ 2.000 em 4x a partir do mês que vem?',
  'Compare meus gastos dos últimos 3 meses.',
  'Quais contas vencem nos próximos 15 dias?',
];
const TOOL_LABEL: Record<string, string> = {
  resumo_atual: 'Resumo de hoje', gastos_por_categoria: 'Gastos por categoria', comparar_meses: 'Comparação mensal',
  listar_movimentacoes: 'Movimentações', maiores_estabelecimentos: 'Maiores gastos', compromissos: 'Compromissos', projetar_saldo: 'Projeção de saldo',
};

async function call<T>(body?: unknown): Promise<T> {
  const r = await fetch('/api/advisor', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }).catch(() => {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data as T;
}

/** Negrito (**texto**) e listas ("- item"), sem HTML vindo do modelo. */
function Rich({ text }: { text: string }) {
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) { list.push(item[1]); continue; }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export default function AdvisorPage() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]), [busy, setBusy] = useState(false), [question, setQuestion] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { call<Status>().then(setStatus).catch((e) => setError(e.message)); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, busy]);

  async function toggle(on: boolean) {
    setBusy(true); setError('');
    try { setStatus(await call<Status>({ action: on ? 'enable' : 'disable' })); if (!on) setTurns([]); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => !t.error).slice(-10).map(({ role, text }) => ({ role, text }));
    setTurns((t) => [...t, { role: 'user', text: q }]); setQuestion(''); setBusy(true); setError('');
    try {
      const r = await call<{ answer: string; steps: Step[]; used: number; limit: number }>({ action: 'ask', payload: { question: q, history } });
      setTurns((t) => [...t, { role: 'assistant', text: r.answer, steps: r.steps }]);
      setStatus((s) => (s ? { ...s, used: r.used } : s));
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', text: (e as Error).message, error: true }]);
    } finally { setBusy(false); }
  }
  function submit(e: FormEvent) { e.preventDefault(); ask(question); }

  if (!status) return <section className="panel padded-form">{error ? <p className="error">{error}</p> : <div className="skeleton" style={{ height: 120 }} />}</section>;
  if (status.plan !== 'full') return <section className="panel padded-form"><p>O consultor é só para contas completas.</p></section>;

  if (!status.enabled) return (
    <section className="panel advisor-intro">
      <Sparkles size={26} />
      <h2>Pergunte sobre as suas finanças</h2>
      <p>O consultor responde com base no que está registrado no app: gastos por categoria, comparação entre meses, compromissos, projeção de saldo e simulações do tipo “e se eu comprar isso em 4x?”.</p>
      <ul className="advisor-facts">
        <li><Calculator size={16} /> Todo número vem dos cálculos do próprio app; você pode ver quais foram usados em cada resposta.</li>
        <li><ShieldCheck size={16} /> Ele só lê. Nada é gravado ou alterado sem você fazer na tela correspondente.</li>
        <li><ShieldCheck size={16} /> Para responder, a pergunta e o resultado dos cálculos (saldos, lançamentos, compromissos) são enviados ao serviço de IA da Anthropic (Claude). E-mail, senha e documentos nunca são enviados, e a conversa não fica guardada no app.</li>
        <li><Sparkles size={16} /> Orienta sobre organização do dinheiro. Não recomenda investimentos.</li>
      </ul>
      {!status.configured && <p className="form-help">O serviço ainda não foi configurado no servidor. Você pode ativar agora; as respostas começam assim que a chave for cadastrada.</p>}
      {error && <p className="error">{error}</p>}
      <button className="button primary" disabled={busy} onClick={() => toggle(true)}>Ativar consultor</button>
    </section>
  );

  return (
    <section className="panel advisor">
      <div className="advisor-thread" aria-live="polite">
        {turns.length === 0 && (
          <div className="advisor-empty">
            <Sparkles size={22} />
            <p>Faça uma pergunta ou escolha uma sugestão.</p>
            <div className="advisor-chips">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`advisor-msg ${t.role} ${t.error ? 'is-error' : ''}`}>
            {t.role === 'assistant' ? <Rich text={t.text} /> : <p>{t.text}</p>}
            {t.steps && t.steps.length > 0 && (
              <details className="advisor-steps">
                <summary><Calculator size={13} /> Cálculos usados ({t.steps.length})</summary>
                <ul>{t.steps.map((s, k) => <li key={k}><strong>{TOOL_LABEL[s.tool] || s.tool}:</strong> {s.summary}</li>)}</ul>
              </details>
            )}
          </div>
        ))}
        {busy && <div className="advisor-msg assistant"><div className="skeleton" style={{ height: 16, width: '60%' }} /><div className="skeleton" style={{ height: 16, width: '40%', marginTop: 8 }} /></div>}
        <div ref={end} />
      </div>
      <form className="advisor-input" onSubmit={submit}>
        <label className="sr-only" htmlFor="advisor-q">Sua pergunta</label>
        <textarea id="advisor-q" rows={2} maxLength={1000} value={question} placeholder="Ex.: quanto gastei com delivery em outubro?"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question); } }} />
        <button className="button primary" disabled={busy || question.trim().length < 2} aria-label="Enviar pergunta"><ArrowUp size={18} /></button>
      </form>
      <div className="advisor-foot">
        <span>{status.used} de {status.limit} perguntas hoje · confira valores importantes nas telas do app</span>
        <button type="button" className="text-button" disabled={busy} onClick={() => toggle(false)}>Desativar consultor</button>
      </div>
    </section>
  );
}
