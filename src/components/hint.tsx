import type { ReactNode } from 'react';

/** Texto curto visível + explicação completa recolhida em "Saiba mais". */
export default function Hint({ short, children }: { short: ReactNode; children?: ReactNode }) {
  return (
    <div className="hint">
      <span>{short}</span>
      {children && (
        <details>
          <summary>Saiba mais</summary>
          <div>{children}</div>
        </details>
      )}
    </div>
  );
}
