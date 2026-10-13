import { randomBytes } from 'crypto';
import { validateEnv } from '../src/config/env.validation';
import { envProfile } from '../src/zatca/zatca.config';

const good = {
  MASTER_KEY: randomBytes(32).toString('base64'),
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
};

describe('validateEnv', () => {
  it('accepts valid values', () => {
    expect(validateEnv({ ...good })).toEqual(good);
  });

  it('rejects a missing MASTER_KEY', () => {
    expect(() => validateEnv({ ...good, MASTER_KEY: undefined })).toThrow('MASTER_KEY مفقود');
    expect(() => validateEnv({ ...good, MASTER_KEY: '' })).toThrow('MASTER_KEY مفقود');
  });

  it('rejects a 16-byte MASTER_KEY', () => {
    expect(() => validateEnv({ ...good, MASTER_KEY: randomBytes(16).toString('base64') })).toThrow('MASTER_KEY غير صالح');
  });

  it('rejects a missing or non-postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...good, DATABASE_URL: undefined })).toThrow('DATABASE_URL مفقود');
    expect(() => validateEnv({ ...good, DATABASE_URL: 'mysql://x' })).toThrow('postgres://');
  });

  it('lists every problem at once and never prints the key', () => {
    const badKey = randomBytes(16).toString('base64');
    try {
      validateEnv({ MASTER_KEY: badKey });
      throw new Error('should have failed');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('MASTER_KEY');
      expect(msg).toContain('DATABASE_URL');
      expect(msg).not.toContain(badKey);
    }
  });
});

describe('envProfile', () => {
  it('returns base URL and certificate template per mode', () => {
    expect(envProfile('developer-portal')).toEqual({
      baseUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
      certTemplateName: 'TSTZATCA-Code-Signing',
    });
    expect(envProfile('simulation').certTemplateName).toBe('PREZATCA-Code-Signing');
    expect(envProfile('core').baseUrl).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/core');
  });

  it('rejects unknown modes', () => {
    expect(() => envProfile('xyz' as never)).toThrow('وضع غير معروف');
  });
});
