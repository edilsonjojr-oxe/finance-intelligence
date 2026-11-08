'use client';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';

/** Lê "#redefinir=TOKEN" do link do e-mail e limpa o endereço (o token não fica no histórico). */
export function readResetToken() {
  if (typeof window === 'undefined') return '';
  const m = window.location.hash.match(/^#redefinir=([A-Za-z0-9_-]{40,64})$/);
  if (!m) return '';
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return m[1];
}

async function post(body: unknown) {
  const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

/** "Esqueci minha senha": pede o e-mail e envia o link. A resposta não revela se a conta existe. */
export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(''), [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') || '');
    setBusy(true); setError('');
    try { await post({ action: 'reset_request', email }); setSent(email); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  if (sent) return (
    <div className="reset-box" role="status">
      <MailCheck size={28} />
      <h2>Confira seu e-mail</h2>
      <p>Se <strong>{sent}</strong> tiver acesso ao app, enviamos um link para criar uma nova senha. Ele vale por 30 minutos. Veja também a caixa de spam.</p>
      <button type="button" className="button full" onClick={onBack}><ArrowLeft size={16} /> Voltar para entrar</button>
    </div>
  );
  return (
    <form onSubmit={submit} className="reset-box">
      <h2>Esqueci minha senha</h2>
      <p>Informe o e-mail da sua conta. Vamos enviar um link para criar uma nova senha.</p>
      <label className="field"><span>E-mail</span><input name="email" type="email" autoComplete="username" required maxLength={254} placeholder="voce@exemplo.com" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'} <ArrowRight size={16} /></button>
      <button type="button" className="text-button" onClick={onBack}><ArrowLeft size={15} /> Voltar para entrar</button>
    </form>
  );
}

/** Link do e-mail: define a nova senha. Todas as sessões abertas são encerradas. */
export function ResetPassword({ token, onDone }: { token: string; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password') || ''), again = String(f.get('again') || '');
    if (password !== again) { setError('As senhas não são iguais.'); return; }
    setBusy(true); setError('');
    try { await post({ action: 'reset_confirm', token, password }); onDone('Senha alterada. Entre com a nova senha.'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="reset-box">
      <h2>Criar nova senha</h2>
      <p>Depois de salvar, você sai de todos os aparelhos e entra de novo com a nova senha.</p>
      <label className="field"><span>Nova senha</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} placeholder="Pelo menos 12 caracteres" /></label>
      <label className="field"><span>Repita a nova senha</span><input name="again" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'} <ArrowRight size={16} /></button>
    </form>
  );
}
