'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Número que sobe até o valor final (600 ms, ease-out). O valor exato fica disponível para
 * leitores de tela desde o início; quem pede menos movimento vê direto o valor final.
 */
export default function CountUp({ value, format, duration = 600 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(value)) {
      setShown(value);
      return;
    }
    const start = performance.now(), origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t < 1 ? origin + (value - origin) * eased : value);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
