import { InvoiceStatus } from '../../database/entities/invoice.entity';

/** أول إعادة محاولة بعد 5 دقائق، ثم تتضاعف حتى 6 ساعات */
export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_MAX_MS = 6 * 60 * 60_000;

/** مدة الانتظار بعد المحاولة رقم attempt (تبدأ من 1): min(5 دقائق × 2^(n-1), 6 ساعات) */
export function backoff(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(RETRY_BASE_MS * 2 ** (n - 1), RETRY_MAX_MS);
}

export interface ClassifyInput {
  /** رمز HTTP من الهيئة، أو غير موجود عند انقطاع الاتصال */
  httpStatus?: number;
  /** رسالة الخطأ عند انقطاع الاتصال أو انتهاء المهلة */
  networkError?: string;
  /** عدد المحاولات بما فيها هذه */
  attempts: number;
  now?: Date;
}

export interface SubmissionOutcome {
  status: Exclude<InvoiceStatus, 'DRY_RUN'>;
  /** موعد المحاولة التالية للمعلّق فقط */
  nextRetryAt: Date | null;
  lastError: string | null;
  /** هل وصلت الفاتورة لحالة نهائية (مقبولة أو مرفوضة) */
  final: boolean;
}

/**
 * تصنيف رد الهيئة:
 * 200 ← ACCEPTED | 202 ← ACCEPTED_WITH_WARNINGS | 400 وباقي 4xx ← REJECTED
 * 401/403 ← PENDING (مشكلة مصادقة، الفاتورة نفسها لم تُرفض) | 429 و 5xx وانقطاع ← PENDING
 * (303 يُعالَج قبل هذه الدالة بإعادة الإرسال عبر الإبلاغ)
 */
export function classifyResponse(input: ClassifyInput): SubmissionOutcome {
  const now = input.now ?? new Date();
  const pending = (lastError: string): SubmissionOutcome => ({
    status: 'PENDING',
    nextRetryAt: new Date(now.getTime() + backoff(input.attempts)),
    lastError,
    final: false,
  });
  const done = (status: SubmissionOutcome['status'], lastError: string | null = null): SubmissionOutcome => ({
    status,
    nextRetryAt: null,
    lastError,
    final: true,
  });

  const code = input.httpStatus;
  if (code === undefined) return pending(input.networkError || 'تعذر الاتصال بمنصة فاتورة');
  if (code === 200) return done('ACCEPTED');
  if (code === 202) return done('ACCEPTED_WITH_WARNINGS');
  if (code === 401 || code === 403) return pending(`مشكلة مصادقة مع الهيئة (${code}): تحقق من الشهادة`);
  if (code === 429 || code >= 500) return pending(`الهيئة غير متاحة مؤقتاً (${code})`);
  if (code >= 400) return done('REJECTED', `رفضت الهيئة الفاتورة (${code})`);
  return pending(`رد غير متوقع من الهيئة (${code})`);
}
