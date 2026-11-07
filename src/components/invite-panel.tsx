'use client';
import { useState } from 'react';

// Gera um convite de uso único. O código aparece só aqui; o servidor guarda apenas o hash.
export default function InvitePanel() {
  const [busy, setBusy] = useState(false),
    [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null),
    [message, setMessage] = useState('');
  async function generate() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível gerar o convite.');
      setInvite(data);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!invite) return;
    const text = `Convite para o Finance Intelligence: ${location.origin}\nCódigo: ${invite.code}\n(Escolha "Tenho um convite" na tela de entrada.)`;
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Convite copiado. Envie para a pessoa por um canal privado.');
    } catch {
      setMessage('Não foi possível copiar automaticamente. Selecione e copie o código.');
    }
  }
  const expires = invite ? new Date(invite.expires_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
  return (
    <section className="panel settings-card">
      <h2>Convidar pessoa</h2>
      <p>
        Gere um código para alguém criar o próprio acesso. Cada pessoa tem login e dados
        separados: ninguém vê as contas de outro usuário.
      </p>
      {invite ? (
        <div className="invite-code">
          <code aria-label="Código de convite">{invite.code}</code>
          <small>Uso único · válido até {expires}</small>
          <div className="invite-actions">
            <button className="button" type="button" onClick={copy}>Copiar convite</button>
            <button className="button" type="button" onClick={generate} disabled={busy}>Gerar outro</button>
          </div>
        </div>
      ) : (
        <button className="button" type="button" onClick={generate} disabled={busy}>
          {busy ? 'Gerando…' : 'Gerar código de convite'}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
