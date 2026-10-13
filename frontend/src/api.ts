import type {
  EnvSettings, InvoiceDetail, InvoicePayload, InvoiceQuery, InvoiceSummary, IssueResult, Mode, ModesResponse,
  OnboardResult, Page, Status,
} from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

/** رسائل رموز الأخطاء من الخادم (عند غيابها تُعرض رسالة الخادم كما هي) */
const ERROR_MESSAGES: Record<string, string> = {
  NO_ACTIVE_MODE: 'لم يُختر وضع تشغيل بعد. اختر الوضع أولاً.',
  CORE_CONFIRMATION_REQUIRED: 'لتفعيل الإنتاج اكتب CORE حرفياً.',
  UNKNOWN_MODE: 'وضع غير معروف.',
  MODE_DISABLED: 'وضع الإنتاج غير متاح حالياً.',
  SETTINGS_INCOMPLETE: 'أكمل إعدادات المنشأة قبل التسجيل.',
  OTP_REQUIRED: 'أدخل رمز OTP من بوابة فاتورة.',
  PENDING_EXISTS: 'توجد فواتير معلّقة في هذا الوضع. أرسلها أولاً قبل إعادة التسجيل.',
  ONBOARDING_IN_PROGRESS: 'يوجد تسجيل جارٍ لهذا الوضع، انتظر حتى ينتهي.',
  FIELDS_LOCKED: 'بعض الحقول مقفلة بعد التسجيل لأنها داخل الشهادة.',
  DUPLICATE_INVOICE_NUMBER: 'رقم الفاتورة مستخدم مسبقاً في هذا الوضع.',
};

const STEP_NAMES: Record<string, string> = {
  'compliance-csid': 'طلب شهادة الامتثال',
  'compliance-checks': 'فحوصات الامتثال',
  'production-csid': 'طلب شهادة الإنتاج',
};

function errorMessage(body: any, status: number): string {
  if (body && typeof body === 'object') {
    if (typeof body.code === 'string' && ERROR_MESSAGES[body.code]) return ERROR_MESSAGES[body.code];
    if (Array.isArray(body.message)) return body.message.join('، ');
    if (typeof body.message === 'string') return body.message;
    if (body.step) return `فشلت خطوة: ${STEP_NAMES[body.step] ?? body.step}`;
  }
  if (status === 502 || status === 503 || status === 504) return 'تعذر الوصول للخادم. تأكد أن حاوية api تعمل.';
  return `خطأ غير متوقع (${status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(errorMessage(body, res.status), res.status, body);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

function toQuery(query: object): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  status: () => request<Status>('/zatca/status'),
  modes: () => request<ModesResponse>('/zatca/modes'),
  mode: () => request<{ active: Mode | null }>('/zatca/mode'),
  setMode: (mode: Mode, confirm?: string) => request<{ active: Mode }>('/zatca/mode', json('PUT', { mode, confirm })),
  settings: (env: Mode) => request<EnvSettings>(`/zatca/environments/${env}/settings`),
  saveSettings: (env: Mode, body: Pick<EnvSettings, 'seller' | 'egs'>) =>
    request<EnvSettings>(`/zatca/environments/${env}/settings`, json('PUT', body)),
  invoices: (query: InvoiceQuery = {}) => request<Page<InvoiceSummary>>(`/zatca/invoices${toQuery(query)}`),
  invoice: (id: string) => request<InvoiceDetail>(`/zatca/invoices/${encodeURIComponent(id)}`),
  /** otp اختياري في بوابة المطورين (يرسل الخادم 123345) */
  onboard: (otp: string | undefined, force: boolean) =>
    request<OnboardResult>('/zatca/onboard', { method: 'POST', body: JSON.stringify({ otp, force }) }),
  issue: (payload: InvoicePayload, dryRun: boolean) =>
    request<IssueResult>(`/zatca/invoices${dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  retryPending: () =>
    request<{ sent: unknown[]; stillPending: number }>('/zatca/invoices/retry-pending', { method: 'POST' }),
  /** id = معرّف الصف (أو رقم الفاتورة مؤقتاً مع dryRun). version: signed | cleared */
  xmlUrl: (id: string, opts: { version?: 'signed' | 'cleared'; dryRun?: boolean } = {}) =>
    `/zatca/invoices/${encodeURIComponent(id)}/xml${toQuery({ version: opts.version, dryRun: opts.dryRun || undefined })}`,
};
