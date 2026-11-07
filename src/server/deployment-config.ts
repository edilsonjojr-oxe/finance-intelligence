type Environment = Record<string, string | undefined>;

export function isHostedDeployment(env: Environment = process.env) {
  return env.CLOUD_DEPLOYMENT === 'true' || env.VERCEL === '1' || env.RENDER === 'true';
}

export function assertPersistentDatabase(env: Environment = process.env) {
  if (isHostedDeployment(env) && !env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL é obrigatória na hospedagem. O banco local não pode ser usado em armazenamento temporário.');
  }
}

/** Cookies só trafegam por HTTPS na hospedagem, mesmo sem COOKIE_SECURE explícito. */
export function secureCookies(env: Environment = process.env) {
  return env.COOKIE_SECURE === 'true' || isHostedDeployment(env);
}

/**
 * TLS para PostgreSQL remoto. Com a CA do provedor (PEM em DATABASE_CA_CERT, aceita "\n"
 * escapado), o certificado e o nome do host são verificados. Na hospedagem a CA é obrigatória;
 * localmente, sem CA, a conexão continua criptografada porém sem verificação do servidor.
 */
export function databaseTLS(env: Environment = process.env): { ca?: string; rejectUnauthorized: boolean } {
  const raw = env.DATABASE_CA_CERT?.trim();
  if (raw) return { ca: normalizePEM(raw), rejectUnauthorized: true };
  if (isHostedDeployment(env)) throw new Error('DATABASE_CA_CERT é obrigatória na hospedagem para verificar o banco.');
  return { rejectUnauthorized: false };
}

/**
 * Painéis de hospedagem costumam trocar as quebras de linha do PEM por espaços ou por "\n"
 * literal. Reconstrói cada certificado no formato canônico (base64 em linhas de 64).
 */
export function normalizePEM(value: string) {
  const text = value.replace(/\\r/g, '').replace(/\\n/g, '\n');
  const blocks = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  if (!blocks.length) throw new Error('DATABASE_CA_CERT deve conter o certificado PEM do provedor.');
  return blocks
    .map(([, body]) => {
      const base64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
      if (!base64) throw new Error('DATABASE_CA_CERT sem conteúdo de certificado.');
      return `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
    })
    .join('');
}
