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
  const ca = env.DATABASE_CA_CERT?.trim().replace(/\\n/g, '\n');
  if (ca) {
    if (!ca.includes('BEGIN CERTIFICATE')) throw new Error('DATABASE_CA_CERT deve conter o certificado PEM do provedor.');
    return { ca, rejectUnauthorized: true };
  }
  if (isHostedDeployment(env)) throw new Error('DATABASE_CA_CERT é obrigatória na hospedagem para verificar o banco.');
  return { rejectUnauthorized: false };
}
