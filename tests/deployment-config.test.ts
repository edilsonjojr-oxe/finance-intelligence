import { describe, it, expect } from 'vitest';
import { assertPersistentDatabase, databaseTLS, isHostedDeployment, secureCookies } from '../src/server/deployment-config';

const pem = '-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----';
describe('TLS do banco e cookies', () => {
  it('exige CA na hospedagem e verifica o servidor quando há CA', () => {
    expect(() => databaseTLS({ VERCEL: '1' })).toThrow('DATABASE_CA_CERT');
    const tls = databaseTLS({ VERCEL: '1', DATABASE_CA_CERT: pem });
    expect(tls.rejectUnauthorized).toBe(true);
    expect(tls.ca).toContain('\n');
  });
  it('recusa CA que não é PEM', () => {
    expect(() => databaseTLS({ DATABASE_CA_CERT: 'texto qualquer' })).toThrow('PEM');
  });
  it('localmente criptografa sem verificação se não houver CA', () => {
    expect(databaseTLS({})).toEqual({ rejectUnauthorized: false });
  });
  it('cookies seguros na hospedagem mesmo sem COOKIE_SECURE', () => {
    expect(secureCookies({ VERCEL: '1' })).toBe(true);
    expect(secureCookies({})).toBe(false);
    expect(secureCookies({ COOKIE_SECURE: 'true' })).toBe(true);
  });
});

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
