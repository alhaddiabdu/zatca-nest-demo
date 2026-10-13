import type { BuyerIdScheme, Category, IssueStatus, Kind, Mode, ModeColor, ModeState } from './types';

export const ENV_LABELS: Record<Mode, string> = {
  'developer-portal': 'بوابة المطورين',
  simulation: 'المحاكاة',
  core: 'الإنتاج',
};

/** لون كل وضع: أخضر للتجربة، برتقالي للمحاكاة، أحمر للإنتاج */
export const MODE_COLORS: Record<Mode, ModeColor> = {
  'developer-portal': 'green',
  simulation: 'orange',
  core: 'red',
};

/** الأوضاع المعطّلة حالياً (مطابقة للخادم): بطاقتها باهتة وغير قابلة للاختيار */
export const DISABLED_MODES: readonly Mode[] = ['core'];

export const MODE_DESCRIPTIONS: Record<Mode, string> = {
  'developer-portal': 'تجربة حرة بإعدادات تجريبية جاهزة، و OTP يُرسل تلقائياً',
  simulation: 'بيانات المنشأة الحقيقية دون أثر رسمي، و OTP من بوابة فاتورة (المحاكاة)',
  core: 'فواتير رسمية تُرسل للهيئة، و OTP من بوابة فاتورة الرسمية',
};

export const MODE_STATE_LABELS: Record<ModeState, string> = {
  unconfigured: 'غير مُعدّ',
  configured: 'مُعدّ',
  onboarded: 'مسجل',
};

export const MODE_STATE_TONES: Record<ModeState, string> = {
  unconfigured: 'neutral',
  configured: 'info',
  onboarded: 'success',
};

/** معرّف المشتري البديل (BR-KSA-81) */
export const BUYER_ID_LABELS: Record<BuyerIdScheme, string> = {
  TIN: 'الرقم المميز (TIN)',
  CRN: 'السجل التجاري (CRN)',
  MOM: 'ترخيص وزارة الشؤون البلدية (MOM)',
  MLS: 'ترخيص وزارة الموارد البشرية (MLS)',
  '700': 'الرقم الموحد 700',
  SAG: 'ترخيص وزارة الاستثمار (SAG)',
  NAT: 'الهوية الوطنية (NAT)',
  GCC: 'هوية مواطني الخليج (GCC)',
  IQA: 'الإقامة (IQA)',
  PAS: 'جواز السفر (PAS)',
  OTH: 'معرّف آخر (OTH)',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  simplified: 'مبسطة (B2C)',
  standard: 'قياسية (B2B)',
};

export const KIND_LABELS: Record<Kind, string> = {
  invoice: 'فاتورة',
  credit: 'إشعار دائن',
  debit: 'إشعار مدين',
};

export const STATUS_LABELS: Record<IssueStatus | 'DRY_RUN', string> = {
  ACCEPTED: 'مقبولة',
  ACCEPTED_WITH_WARNINGS: 'مقبولة مع تحذيرات',
  REJECTED: 'مرفوضة',
  PENDING: 'معلّقة',
  DRY_RUN: 'تجربة',
};

export const STATUS_TONES: Record<IssueStatus | 'DRY_RUN', string> = {
  ACCEPTED: 'success',
  ACCEPTED_WITH_WARNINGS: 'warning',
  REJECTED: 'danger',
  PENDING: 'neutral',
  DRY_RUN: 'info',
};

const money = new Intl.NumberFormat('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatMoney = (n: number) => `${money.format(n)} ر.س`;

/** كل الأوقات تُعرض بتوقيت الرياض مهما كانت منطقة جهاز المستخدم */
export const RIYADH_TZ = 'Asia/Riyadh';

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'medium', timeStyle: 'short', timeZone: RIYADH_TZ });

/**
 * وقت إصدار الفاتورة (IssueDate + IssueTime) بتوقيت الرياض.
 * الجديد بتوقيت UTC وينتهي بـ Z، والفواتير القديمة HH:mm:ss بتوقيت الرياض أصلاً.
 */
export const formatIssueTime = (issueDate: string, issueTime: string) => {
  const iso = `${issueDate}T${issueTime.endsWith('Z') ? issueTime : `${issueTime}+03:00`}`;
  return new Date(iso).toLocaleString('ar-SA-u-nu-latn-ca-gregory', {
    dateStyle: 'medium', timeStyle: 'medium', timeZone: RIYADH_TZ,
  });
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * صافي البند = الكمية × السعر بدقة عشرية ثم خانتان (نصف للأعلى)، مطابق للخادم (src/zatca/amounts.ts).
 * يأخذ النص كما كُتب في الحقل: 3 × 10.005 = 30.02 (وبأرقام JS العادية 30.01).
 */
export function lineNet(quantity: string, unitPrice: string): number {
  const scaled = (s: string) => {
    const [i = '0', f = ''] = (s.trim() || '0').replace(/^\+/, '').split('.');
    return /^\d*$/.test(i) && /^\d*$/.test(f) ? { v: BigInt((i || '0') + f), d: f.length } : null;
  };
  const q = scaled(quantity);
  const p = scaled(unitPrice);
  // صيغة غير عادية (أسية مثلاً): تقدير تقريبي للعرض فقط
  if (!q || !p) return round2(Number(quantity || 0) * Number(unitPrice || 0));
  const product = q.v * p.v;
  const d = q.d + p.d;
  if (d <= 2) return Number(product * 10n ** BigInt(2 - d)) / 100;
  const div = 10n ** BigInt(d - 2);
  return Number(product / div + ((product % div) * 2n >= div ? 1n : 0n)) / 100;
}
