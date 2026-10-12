import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** رمز حقن مفتاح التشفير الرئيسي (32 بايت) */
export const MASTER_KEY = Symbol('MASTER_KEY');

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * يحوّل نص MASTER_KEY (Base64) إلى مفتاح 32 بايت، أو يرمي خطأ واضحاً.
 * لتوليد مفتاح: openssl rand -base64 32
 */
export function parseMasterKey(value: string | undefined): Buffer {
  if (!value) throw new Error('MASTER_KEY مفقود');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value.trim()) {
    throw new Error('MASTER_KEY غير صالح: يجب أن يكون Base64 لـ 32 بايت بالضبط (openssl rand -base64 32)');
  }
  return key;
}

/**
 * تشفير الأسرار المخزنة في القاعدة (المفتاح الخاص، secret، binarySecurityToken) بـ AES-256-GCM.
 *
 * الصيغة المخزنة: v1:<iv>:<tag>:<ciphertext> (كلها Base64)، و iv عشوائي 12 بايت لكل قيمة.
 * aad يربط القيمة بمكانها (مثل "core:private_key_enc")، فنقلها لعمود أو وضع آخر يُفشل فكّها.
 * لا تُكتب القيم ولا المفتاح في أي رسالة خطأ أو سجل.
 */
@Injectable()
export class CryptoBoxService {
  constructor(@Inject(MASTER_KEY) private readonly key: Buffer) {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error('مفتاح التشفير يجب أن يكون 32 بايت');
    }
  }

  encrypt(plain: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  decrypt(stored: string, aad: string): string {
    const parts = stored.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('صيغة القيمة المشفرة غير معروفة');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('صيغة القيمة المشفرة غير صحيحة');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      // لا نكشف السبب: مفتاح خاطئ، أو عبث بالقيمة، أو aad مختلف
      throw new Error(`تعذر فك تشفير القيمة (${aad}): المفتاح أو القيمة أو مكانها غير مطابق`);
    }
  }
}
