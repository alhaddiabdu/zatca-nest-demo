/**
 * رمز QR للمرحلة الثانية: سلسلة TLV (Tag-Length-Value) مرمّزة Base64.
 * الوسوم 1-5 نصوص، 6-7 نص Base64 كما هو، 8-9 بايتات خام.
 */
export interface QrInput {
  sellerName: string; // 1
  vatNumber: string; // 2
  timestamp: string; // 3  مثل 2026-10-12T14:30:00 (مطابق لـ IssueDate و IssueTime)
  totalWithVat: string; // 4
  vatTotal: string; // 5
  invoiceHash: string; // 6
  signature: string; // 7
  publicKey: Buffer; // 8
  certSignature?: Buffer; // 9 (مطلوب في الفواتير المبسطة)
}

function tlv(tag: number, value: Buffer): Buffer {
  if (value.length > 255) throw new Error(`قيمة الوسم ${tag} أطول من 255 بايت`);
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export function buildQr(input: QrInput): string {
  const parts = [
    tlv(1, Buffer.from(input.sellerName, 'utf8')),
    tlv(2, Buffer.from(input.vatNumber, 'utf8')),
    tlv(3, Buffer.from(input.timestamp, 'utf8')),
    tlv(4, Buffer.from(input.totalWithVat, 'utf8')),
    tlv(5, Buffer.from(input.vatTotal, 'utf8')),
    tlv(6, Buffer.from(input.invoiceHash, 'utf8')),
    tlv(7, Buffer.from(input.signature, 'utf8')),
    tlv(8, input.publicKey),
  ];
  if (input.certSignature) parts.push(tlv(9, input.certSignature));
  return Buffer.concat(parts).toString('base64');
}

/** لفك رمز QR والتحقق منه (مفيد في الاختبار) */
export function decodeQr(base64: string): Record<number, string> {
  const buf = Buffer.from(base64, 'base64');
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    const value = buf.subarray(i + 2, i + 2 + len);
    out[tag] = tag <= 7 ? value.toString('utf8') : value.toString('base64');
    i += 2 + len;
  }
  return out;
}
