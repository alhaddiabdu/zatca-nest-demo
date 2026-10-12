import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { ENV_LABELS, formatDate } from './format';
import type { ComplianceCheck, OnboardResult, Status } from './types';

const STEPS = [
  'توليد المفتاح الخاص وطلب الشهادة (CSR)',
  'إرسال رمز OTP وطلب شهادة الامتثال',
  'إرسال فواتير تجريبية لفحوصات الامتثال',
  'استلام شهادة الإنتاج',
];

const DOC_LABELS: Record<string, string> = {
  'standard-invoice': 'فاتورة قياسية',
  'standard-credit': 'إشعار دائن قياسي',
  'standard-debit': 'إشعار مدين قياسي',
  'simplified-invoice': 'فاتورة مبسطة',
  'simplified-credit': 'إشعار دائن مبسط',
  'simplified-debit': 'إشعار مدين مبسط',
};

interface Props {
  status: Status | null;
  onDone: () => void;
}

export function Onboarding({ status, onDone }: Props) {
  const isDevPortal = status?.env === 'developer-portal';
  const [otp, setOtp] = useState(isDevPortal ? '123345' : '');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (isDevPortal) setOtp((o) => o || '123345');
  }, [isDevPortal]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.onboard(otp, force));
      setForce(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0, null));
    } finally {
      setBusy(false);
    }
  };

  const failedChecks = (error?.body as { results?: ComplianceCheck[] } | null)?.results;
  const checks = result?.complianceChecks ?? failedChecks;

  return (
    <div className="stack">
      <form className="card form" onSubmit={submit}>
        <div className="card-head">
          <h2>التسجيل لدى الهيئة</h2>
          {status && (
            <span className={`badge ${status.onboarded ? 'success' : 'neutral'}`}>
              {status.onboarded ? 'مسجّلة' : 'غير مسجّلة'}
            </span>
          )}
        </div>

        <p className="hint">
          تُنفَّذ مرة واحدة لكل جهاز أو فرع. البيئة الحالية: <strong>{status ? ENV_LABELS[status.env] : '…'}</strong>
          {status?.onboardedAt && <> — سُجّلت في {formatDate(status.onboardedAt)}</>}
        </p>

        <ol className="steps">
          {STEPS.map((s) => <li key={s}>{s}</li>)}
        </ol>

        <div className="grid-2 align-end">
          <label className="field">
            <span>رمز OTP</span>
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              pattern="\d{6}"
              title="6 أرقام"
              inputMode="numeric"
              dir="ltr"
              placeholder="000000"
            />
            <small>
              {isDevPortal
                ? 'في بوابة المطورين يعمل أي رمز من 6 أرقام.'
                : 'استخرجه من بوابة فاتورة، وهو صالح لدقائق فقط.'}
            </small>
          </label>
          <div className="field">
            {status?.onboarded && (
              <label className="toggle">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>إعادة التسجيل (يبدأ سلسلة فواتير جديدة)</span>
              </label>
            )}
            <button className="btn primary" disabled={busy || (status?.onboarded && !force)}>
              {busy ? 'جارٍ التسجيل… قد يستغرق دقيقة' : 'بدء التسجيل'}
            </button>
          </div>
        </div>

        {result && <div className="alert success" role="status"><strong>{result.message}</strong></div>}
        {error && (
          <div className="alert danger" role="alert">
            <strong>{error.message}</strong>
            {error.body != null && typeof error.body === 'object' && !failedChecks && (
              <details>
                <summary>التفاصيل</summary>
                <pre dir="ltr">{JSON.stringify(error.body, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
      </form>

      {checks && checks.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>نتائج فحوصات الامتثال</h2></div>
          <table className="table">
            <thead>
              <tr><th>الوثيقة</th><th>الحالة</th><th>الملاحظات</th></tr>
            </thead>
            <tbody>
              {checks.map((c) => {
                const v = c.response?.validationResults;
                const msgs = [...(v?.errorMessages ?? []), ...(v?.warningMessages ?? [])];
                return (
                  <tr key={c.document}>
                    <td>{DOC_LABELS[c.document] ?? c.document}</td>
                    <td><span className={`badge ${c.ok ? 'success' : 'danger'}`}>{c.ok ? 'نجح' : 'فشل'} ({c.status})</span></td>
                    <td>{msgs.length ? msgs.map((m, i) => <div key={i}><code>{m.code}</code> {m.message}</div>) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
