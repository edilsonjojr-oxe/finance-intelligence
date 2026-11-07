'use client';
import { useState } from 'react';

/** Sessões: duração e "sair de todos os aparelhos" (inclusive este). */
export default function SessionPanel() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function endAll() {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout_all' }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Não foi possível encerrar as sessões.');
      location.reload();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <section className="panel settings-card">
      <h2>Acesso</h2>
      <p>Você continua conectado enquanto usar o app. A sessão expira após 7 dias sem uso ou 30 dias do login.</p>
      <button className="button" type="button" disabled={busy} onClick={endAll}>{busy ? 'Encerrando…' : 'Sair de todos os aparelhos'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
