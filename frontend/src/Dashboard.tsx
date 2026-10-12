import { formatDate, STATUS_LABELS, STATUS_TONES } from './format';
import type { InvoiceStatus, Status } from './types';

/** ترتيب عرض الحالات في اللوحة */
const STATUS_ORDER: InvoiceStatus[] = ['ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'REJECTED', 'PENDING', 'DRY_RUN'];

/** الشهادة تقترب من الانتهاء خلال 30 يوماً */
const EXPIRY_WARNING_MS = 30 * 24 * 60 * 60_000;

interface Props {
  status: Status;
  onRetry: () => void;
  retrying: boolean;
  retryMsg: string | null;
  /** يفتح جدول الفواتير على حالة معيّنة */
  onShowStatus?: (status: InvoiceStatus) => void;
}

/** نظرة عامة على الوضع النشط: التسجيل، الشهادة، السلسلة، والفواتير حسب الحالة */
export function Dashboard({ status, onRetry, retrying, retryMsg, onShowStatus }: Props) {
  const counts = status.countsByStatus;
  const notAfter = status.productionCertNotAfter ? new Date(status.productionCertNotAfter) : null;
  const expiringSoon = notAfter ? notAfter.getTime() - Date.now() < EXPIRY_WARNING_MS : false;

  return (
    <div className="stack">
      {(status.pendingOverdue ?? 0) > 0 && (
        <div className="alert danger" role="alert">
          <strong>{status.pendingOverdue} فواتير مبسطة معلّقة منذ أكثر من 24 ساعة</strong>
          <span>يجب إبلاغ الهيئة بالفاتورة المبسطة خلال 24 ساعة من إصدارها. أعد الإرسال أو تحقق من الاتصال.</span>
        </div>
      )}

      <section className="status dashboard-cards">
        <div className="stat">
          <span>المنشأة</span>
          <strong>{status.seller.name}</strong>
          <small dir="ltr">{status.seller.vatNumber}</small>
        </div>
        <div className="stat">
          <span>التسجيل لدى الهيئة</span>
          <strong className={status.onboarded ? 'ok' : 'muted'}>{status.onboarded ? 'مسجّلة ✓' : 'غير مسجّلة'}</strong>
          {status.onboardedAt && <small>{formatDate(status.onboardedAt)}</small>}
        </div>
        <div className="stat">
          <span>انتهاء الشهادة</span>
          <strong className={expiringSoon ? 'warn' : undefined}>{notAfter ? formatDate(notAfter.toISOString()) : '—'}</strong>
          {expiringSoon && <small className="warn">تنتهي قريباً، جدّدها</small>}
        </div>
        <div className="stat">
          <span>آخر عداد (ICV)</span>
          <strong dir="ltr">{status.chain.icv}</strong>
          {status.chain.chainEpoch !== undefined && <small>دورة السلسلة {status.chain.chainEpoch}</small>}
        </div>
        <div className="stat">
          <span>معلّقة للإرسال</span>
          <strong dir="ltr">{status.pendingCount}</strong>
          {status.pendingCount > 0 && (
            <button className="link" onClick={onRetry} disabled={retrying}>
              {retrying ? 'جارٍ الإرسال…' : 'إعادة الإرسال الآن'}
            </button>
          )}
          {retryMsg && <small>{retryMsg}</small>}
        </div>
      </section>

      {counts && (
        <section className="card">
          <div className="card-head"><h2>الفواتير حسب الحالة</h2></div>
          <div className="status-counts">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                className="status-count"
                onClick={onShowStatus ? () => onShowStatus(s) : undefined}
                disabled={!onShowStatus}
              >
                <span className={`badge ${STATUS_TONES[s]}`}>{STATUS_LABELS[s]}</span>
                <strong dir="ltr" data-status={s}>{counts[s] ?? 0}</strong>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
