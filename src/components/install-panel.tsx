'use client';
import { useEffect, useState } from 'react';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** "Instalar app": Android/Chrome usa o prompt nativo; iPhone recebe a instrução do Safari. */
export default function InstallPanel() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [mode, setMode] = useState<'hidden' | 'android' | 'ios' | 'other'>('hidden');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setMode(ios ? 'ios' : 'other');
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallEvent); setMode('android'); };
    const onInstalled = () => { setMode('hidden'); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  if (mode === 'hidden') return null;
  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    setMessage(outcome === 'accepted' ? 'Instalando… o ícone aparece na tela inicial.' : 'Instalação cancelada.');
  }
  return (
    <section className="panel settings-card">
      <h2>Instalar app</h2>
      <p>Abra o Finance Intelligence pela tela inicial do celular, em tela cheia, como um aplicativo.</p>
      {mode === 'android' && <button className="button" type="button" onClick={install}>Instalar na tela inicial</button>}
      {mode === 'ios' && <p><strong>No Safari:</strong> toque em <strong>Compartilhar</strong> (quadrado com seta) → <strong>Adicionar à Tela de Início</strong>.</p>}
      {mode === 'other' && <p>No Chrome do Android, use o menu ⋮ → <strong>Instalar app</strong>. No iPhone, abra no Safari e use Compartilhar → Adicionar à Tela de Início.</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
