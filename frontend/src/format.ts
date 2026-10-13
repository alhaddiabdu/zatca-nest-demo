import type { Category, IssueStatus, Kind, Mode, ModeColor, ModeState } from './types';

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
