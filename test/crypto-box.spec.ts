import { randomBytes } from 'crypto';
import { CryptoBoxService, parseMasterKey } from '../src/security/crypto-box.service';

describe('CryptoBoxService (AES-256-GCM)', () => {
  const box = new CryptoBoxService(randomBytes(32));
  const aad = 'core:private_key_enc';
  // قيمة تشبه المفتاح الخاص: أسطر متعددة، وليست مفتاحاً حقيقياً
  const plain = '-----BEGIN TEST VALUE-----\nسطر عربي 123\nline-2\n-----END TEST VALUE-----\n';

  it('round-trips multi-line and Arabic text', () => {
    const stored = box.encrypt(plain, aad);
    expect(box.decrypt(stored, aad)).toBe(plain);
  });

  it('stores v1:iv:tag:ct without the plaintext', () => {
    const stored = box.encrypt(plain, aad);
    const parts = stored.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2], 'base64')).toHaveLength(16);
    expect(stored).not.toContain('BEGIN');
  });

  it('uses a different iv for every encryption', () => {
    const a = box.encrypt(plain, aad);
    const b = box.encrypt(plain, aad);
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
  });

  it('fails when a ciphertext byte is changed', () => {
    const [v, iv, tag, ct] = box.encrypt(plain, aad).split(':');
    const bytes = Buffer.from(ct, 'base64');
    bytes[0] ^= 0x01;
    expect(() => box.decrypt([v, iv, tag, bytes.toString('base64')].join(':'), aad)).toThrow('تعذر فك تشفير');
  });

  it('fails when the auth tag is changed', () => {
    const [v, iv, tag, ct] = box.encrypt(plain, aad).split(':');
    const bytes = Buffer.from(tag, 'base64');
    bytes[0] ^= 0x01;
    expect(() => box.decrypt([v, iv, bytes.toString('base64'), ct].join(':'), aad)).toThrow('تعذر فك تشفير');
  });

  it('fails with a different aad (value moved to another column or mode)', () => {
    const stored = box.encrypt(plain, aad);
    expect(() => box.decrypt(stored, 'simulation:private_key_enc')).toThrow('تعذر فك تشفير');
    expect(() => box.decrypt(stored, 'core:production_secret_enc')).toThrow('تعذر فك تشفير');
  });

  it('fails with another key', () => {
    const stored = box.encrypt(plain, aad);
    const other = new CryptoBoxService(randomBytes(32));
    expect(() => other.decrypt(stored, aad)).toThrow('تعذر فك تشفير');
  });

  it('rejects unknown formats', () => {
    expect(() => box.decrypt('not-encrypted', aad)).toThrow('صيغة القيمة المشفرة غير معروفة');
    expect(() => box.decrypt('v2:a:b:c', aad)).toThrow('صيغة القيمة المشفرة غير معروفة');
    expect(() => box.decrypt('v1:AAAA:BBBB:CCCC', aad)).toThrow('صيغة القيمة المشفرة غير صحيحة');
  });

  it('never puts the plaintext in error messages', () => {
    const stored = box.encrypt('very-secret-value', aad);
    try {
      new CryptoBoxService(randomBytes(32)).decrypt(stored, aad);
      throw new Error('should have failed');
    } catch (e) {
      expect((e as Error).message).not.toContain('very-secret-value');
    }
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new CryptoBoxService(randomBytes(16))).toThrow('32 بايت');
  });
});

describe('parseMasterKey', () => {
  it('accepts Base64 of exactly 32 bytes', () => {
    const value = randomBytes(32).toString('base64');
    expect(parseMasterKey(value)).toHaveLength(32);
  });

  it('rejects missing, short, long and non-Base64 values', () => {
    expect(() => parseMasterKey(undefined)).toThrow('MASTER_KEY مفقود');
    expect(() => parseMasterKey('')).toThrow('MASTER_KEY مفقود');
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow('MASTER_KEY غير صالح');
    expect(() => parseMasterKey(randomBytes(48).toString('base64'))).toThrow('MASTER_KEY غير صالح');
    expect(() => parseMasterKey('this is not base64 at all!!!!!!!!!!!!!!!!!!')).toThrow('MASTER_KEY غير صالح');
  });
});
