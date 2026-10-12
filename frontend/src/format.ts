import type { Category, IssueStatus, Kind, Status } from './types';

export const ENV_LABELS: Record<Status['env'], string> = {
  'developer-portal': 'بوابة المطورين',
  simulation: 'المحاكاة',
  core: 'الإنتاج',
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

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
