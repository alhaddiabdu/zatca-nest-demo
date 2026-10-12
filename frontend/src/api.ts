import type { InvoicePayload, IssueResult, OnboardResult, Status } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

const STEP_NAMES: Record<string, string> = {
  'compliance-csid': 'طلب شهادة الامتثال',
  'compliance-checks': 'فحوصات الامتثال',
  'production-csid': 'طلب شهادة الإنتاج',
};

function errorMessage(body: any, status: number): string {
  if (body && typeof body === 'object') {
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

export const api = {
  status: () => request<Status>('/zatca/status'),
  onboard: (otp: string, force: boolean) =>
    request<OnboardResult>('/zatca/onboard', { method: 'POST', body: JSON.stringify({ otp, force }) }),
  issue: (payload: InvoicePayload, dryRun: boolean) =>
    request<IssueResult>(`/zatca/invoices${dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  retryPending: () =>
    request<{ sent: unknown[]; stillPending: number }>('/zatca/invoices/retry-pending', { method: 'POST' }),
  xmlUrl: (id: string, dryRun: boolean) =>
    `/zatca/invoices/${encodeURIComponent(id)}/xml${dryRun ? '?dryRun=true' : ''}`,
};
