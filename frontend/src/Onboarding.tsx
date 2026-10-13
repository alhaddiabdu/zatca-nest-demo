import { FormEvent, useState } from 'react';
import { api, ApiError } from './api';
import { ENV_LABELS, formatDate } from './format';
import type { ComplianceCheck, OnboardResult, Status } from './types';
import { ZatcaResponse } from './ZatcaResponse';

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
  /** يفتح جدول الفواتير على المعلّقة (عند رفض إعادة التسجيل بسببها) */
  onShowPending?: () => void;
}

/** أين يجد المستخدم OTP في كل وضع */
const OTP_HINTS: Record<Status['env'], string> = {
  'developer-portal': '',
  simulation: '6 أرقام من بوابة فاتورة (المحاكاة) ← إضافة جهاز.',
  core: 'استخرجه من بوابة فاتورة الرسمية (fatoora.zatca.gov.sa ← إضافة جهاز). صالح لدقائق فقط.',
};

export function Onboarding({ status, onDone, onShowPending }: Props) {
  const isDevPortal = status?.env === 'developer-portal';
  const [otp, setOtp] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // في بوابة المطورين لا نرسل OTP، فيرسل الخادم 123345 تلقائياً
      setResult(await api.onboard(isDevPortal ? undefined : otp, force));
      setForce(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0, null));
    } finally {
      setBusy(false);
    }
  };

  const errorBody = error?.body as { results?: ComplianceCheck[]; code?: string; zatca?: { status: number; body: unknown } } | null;
  const failedChecks = errorBody?.results;
  const errorCode = errorBody?.code;
  // فشل طلب شهادة الامتثال أو الإنتاج: رد الهيئة كما وصل
  const zatcaFailure = errorBody?.zatca;
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

        {status?.env === 'simulation' && (
          <div className="alert warning" role="note">
            <strong>قبل التسجيل في المحاكاة</strong>
            <ul>
              <li>رمز OTP يُستخرج من بوابة فاتورة — بيئة المحاكاة (fatoora.zatca.gov.sa ← المحاكاة ← إضافة جهاز).</li>
              <li>صلاحية الرمز قصيرة (دقائق)، فاستخرجه مباشرة قبل الضغط على «بدء التسجيل».</li>
              <li>
                الرقم الضريبي في الإعدادات (<code dir="ltr">{status.seller?.vatNumber || '—'}</code>) يجب أن يطابق رقم المنشأة
                في الحساب الذي استخرجت منه الرمز، وإلا ترفض الهيئة الطلب.
              </li>
            </ul>
          </div>
        )}

        <div className="grid-2 align-end">
          {isDevPortal ? (
            <div className="field">
              <span>رمز OTP</span>
              <p className="hint">في بوابة المطورين يُرسل الرمز <code dir="ltr">123345</code> تلقائياً، لا حاجة لإدخاله.</p>
            </div>
          ) : (
            <label className="field">
              <span>رمز OTP</span>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                minLength={6}
                maxLength={6}
                pattern="\d{6}"
                title="رمز OTP من 6 أرقام"
                autoComplete="one-time-code"
                inputMode="numeric"
                dir="ltr"
                placeholder="000000"
              />
              <small>{status ? OTP_HINTS[status.env] : ''}</small>
            </label>
          )}
          <div className="field">
            {status?.onboarded && (
              <label className="toggle">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>إعادة التسجيل (يبدأ سلسلة فواتير جديدة)</span>
              </label>
            )}
            <button className="btn primary" disabled={busy || (status?.onboarded && !force) || (!isDevPortal && !/^\d{6}$/.test(otp))}>
              {busy ? 'جارٍ التسجيل… قد يستغرق دقيقة' : 'بدء التسجيل'}
            </button>
          </div>
        </div>

        {result && <div className="alert success" role="status"><strong>{result.message}</strong></div>}
        {error && (
          <div className="alert danger" role="alert">
            <strong>{error.message}</strong>
            {errorCode === 'PENDING_EXISTS' && onShowPending && (
              <button type="button" className="btn ghost small" onClick={onShowPending}>
                عرض الفواتير المعلّقة
              </button>
            )}
            {zatcaFailure ? (
              <ZatcaResponse body={zatcaFailure.body} httpStatus={zatcaFailure.status} showInfo />
            ) : (
              error.body != null && typeof error.body === 'object' && !failedChecks && (
                <details>
                  <summary>التفاصيل</summary>
                  <pre dir="ltr">{JSON.stringify(error.body, null, 2)}</pre>
                </details>
              )
            )}
          </div>
        )}
      </form>

      {checks && checks.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>نتائج فحوصات الامتثال</h2></div>
          <table className="table">
            <thead>
              <tr><th>الوثيقة</th><th>الحالة</th><th>رد الهيئة</th></tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.document}>
                  <td>{DOC_LABELS[c.document] ?? c.document}</td>
                  <td><span className={`badge ${c.ok ? 'success' : 'danger'}`}>{c.ok ? 'نجح' : 'فشل'}</span></td>
                  <td><ZatcaResponse body={c.response} httpStatus={c.status} showRaw={!c.ok} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
