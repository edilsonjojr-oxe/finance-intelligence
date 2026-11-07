'use client';
import { useEffect } from 'react';

/** Registra o service worker só em produção e em HTTPS (critério de instalação do app). */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || location.protocol !== 'https:' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
