import { describe, it, expect } from 'vitest';
import { assertPersistentDatabase, isHostedDeployment } from '../src/server/deployment-config';

describe('Persistência na hospedagem', () => {
  it.each([{VERCEL:'1'}, {RENDER:'true'}, {CLOUD_DEPLOYMENT:'true'}])('recusa banco local efêmero em %j', env => {
    expect(isHostedDeployment(env)).toBe(true);
    expect(() => assertPersistentDatabase(env)).toThrow('DATABASE_URL');
    expect(() => assertPersistentDatabase({...env,DATABASE_URL:'   '})).toThrow('DATABASE_URL');
  });
  it('preserva banco embarcado somente no ambiente local', () => {
    expect(() => assertPersistentDatabase({})).not.toThrow();
    expect(isHostedDeployment({NODE_ENV:'production'})).toBe(false);
  });
  it('permite banco externo configurado na hospedagem', () => {
    expect(() => assertPersistentDatabase({VERCEL:'1',DATABASE_URL:'postgresql://configured.invalid/finance'})).not.toThrow();
  });
});
