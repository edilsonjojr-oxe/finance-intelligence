type Environment = Record<string, string | undefined>;

export function isHostedDeployment(env: Environment = process.env) {
  return env.CLOUD_DEPLOYMENT === 'true' || env.VERCEL === '1' || env.RENDER === 'true';
}

export function assertPersistentDatabase(env: Environment = process.env) {
  if (isHostedDeployment(env) && !env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL é obrigatória na hospedagem. O banco local não pode ser usado em armazenamento temporário.');
  }
}
