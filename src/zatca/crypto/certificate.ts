import { createHash, X509Certificate } from 'crypto';

/** يحوّل binarySecurityToken القادم من الهيئة إلى نص الشهادة (Base64 DER) */
export function tokenToCertBase64(binarySecurityToken: string): string {
  return Buffer.from(binarySecurityToken, 'base64').toString('utf8').trim();
}

export function certBase64ToPem(certBase64: string): string {
  const body = certBase64.replace(/(.{64})/g, '$1\n').trim();
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
}

export function pemToCertBase64(pem: string): string {
  return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

export interface CertificateInfo {
  certBase64: string;
  /** Base64 لتمثيل hex لـ SHA-256 على نص الشهادة (هكذا تحسبه الهيئة) */
  certHash: string;
  issuerName: string;
  serialNumber: string;
  /** المفتاح العام بصيغة SPKI DER (الوسم 8 في QR) */
  publicKeyDer: Buffer;
  /** توقيع الجهة المصدرة على الشهادة (الوسم 9 في QR) */
  certSignature: Buffer;
}

export function getCertificateInfo(certBase64: string): CertificateInfo {
  const x509 = new X509Certificate(certBase64ToPem(certBase64));
  const certHash = Buffer.from(createHash('sha256').update(certBase64, 'utf8').digest('hex')).toString(
    'base64',
  );

  return {
    certBase64,
    certHash,
    // Node يعطي المصدر سطراً لكل جزء بترتيب معكوس، والهيئة تتوقعه مفصولاً بفواصل
    issuerName: x509.issuer.split('\n').reverse().join(', '),
    serialNumber: BigInt('0x' + x509.serialNumber).toString(10),
    publicKeyDer: x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    certSignature: extractCertificateSignature(Buffer.from(certBase64, 'base64')),
  };
}

/**
 * يستخرج signatureValue من الشهادة بقراءة بنية DER مباشرة:
 * Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }
 */
export function extractCertificateSignature(der: Buffer): Buffer {
  const readTL = (offset: number) => {
    const tag = der[offset];
    let len = der[offset + 1];
    let header = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + der[offset + 2 + i];
      header += n;
    }
    return { tag, len, header };
  };
  const outer = readTL(0);
  let pos = outer.header;
  const tbs = readTL(pos);
  pos += tbs.header + tbs.len;
  const alg = readTL(pos);
  pos += alg.header + alg.len;
  const sig = readTL(pos);
  if (sig.tag !== 0x03) throw new Error('بنية الشهادة غير متوقعة');
  // أول بايت في BIT STRING هو عدد البتات غير المستخدمة (0)
  return der.subarray(pos + sig.header + 1, pos + sig.header + sig.len);
}
