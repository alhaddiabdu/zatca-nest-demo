/**
 * حساب المبالغ بالنظام العشري الدقيق بدل أرقام JS العشرية الثنائية.
 * مثال: 3 × 10.005 في JS = 30.014999999999997 فيُقرَّب خطأً إلى 30.01،
 * والصحيح 30.015 ← 30.02 (BR-KSA-EN16931-11: صافي البند = الكمية × السعر).
 */

/** الرقم كما كتبه المستخدم: أقصر تمثيل عشري يعيد نفس القيمة، بدون صيغة أسية (1e-7 ← 0.0000001) */
export function decimalString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`رقم غير صالح: ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  const [mantissa, expPart] = s.toLowerCase().split('e');
  const neg = mantissa.startsWith('-');
  const [intPart, fracPart = ''] = mantissa.replace('-', '').split('.');
  let digits = intPart + fracPart;
  let point = intPart.length + Number(expPart);
  if (point <= 0) {
    digits = '0'.repeat(1 - point) + digits;
    point = 1;
  }
  if (point > digits.length) digits += '0'.repeat(point - digits.length);
  const out = digits.slice(0, point).replace(/^0+(?=\d)/, '') + (point < digits.length ? `.${digits.slice(point)}` : '');
  return neg ? `-${out}` : out;
}

/** قيمة عشرية كعدد صحيح ومقياس: 10.005 ← { value: 10005n, scale: 3 } */
function toScaled(n: number): { value: bigint; scale: number } {
  const [i, f = ''] = decimalString(n).split('.');
  return { value: BigInt(i + f), scale: f.length };
}

/** الكمية × السعر بدقة كاملة ثم تقريب لخانتين (نصف للأعلى) */
export function lineNet(quantity: number, unitPrice: number): number {
  const q = toScaled(quantity);
  const p = toScaled(unitPrice);
  const product = q.value * p.value;
  const scale = q.scale + p.scale;
  if (scale <= 2) return Number(product * 10n ** BigInt(2 - scale)) / 100;
  const divisor = 10n ** BigInt(scale - 2);
  const sign = product < 0n ? -1n : 1n;
  const abs = product * sign;
  let cents = abs / divisor;
  if ((abs % divisor) * 2n >= divisor) cents += 1n;
  return Number(cents * sign) / 100;
}

/** سعر الوحدة كما أُدخل دون تقريب، بخانتين على الأقل للقراءة: 15 ← 15.00 و 10.005 ← 10.005 */
export function priceText(unitPrice: number): string {
  const s = decimalString(unitPrice);
  const frac = s.split('.')[1] ?? '';
  return frac.length >= 2 ? s : `${s}${frac ? '' : '.'}${'0'.repeat(2 - frac.length)}`;
}
