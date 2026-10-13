import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { CATEGORY_LABELS, formatDate, formatIssueTime, formatMoney, KIND_LABELS, STATUS_LABELS, STATUS_TONES } from './format';
import { QrFigure, ZatcaMessages } from './InvoiceResult';
import type { InvoiceDetail } from './types';

export type DetailsTab = 'summary' | 'signed' | 'cleared' | 'response';

const TAB_LABELS: Record<DetailsTab, string> = {
  summary: 'ملخص',
  signed: 'XML الموقّع',
  cleared: 'XML المعتمد',
  response: 'رد الهيئة',
};

interface Props {
  id: string;
  onClose: () => void;
}

/** تفاصيل فاتورة من الخادم: الملخص، الـ XML الموقّع والمعتمد، ورد الهيئة */
export function InvoiceDetails({ id, onClose }: Props) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [tab, setTab] = useState<DetailsTab>('summary');
  const [xml, setXml] = useState<Partial<Record<'signed' | 'cleared', string>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.invoice(id).then(setDetail).catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [id]);

  // يُحمَّل الـ XML عند فتح تبويبه فقط
  useEffect(() => {
    if ((tab === 'signed' || tab === 'cleared') && xml[tab] === undefined) {
      fetch(api.xmlUrl(id, { version: tab }))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((text) => setXml((x) => ({ ...x, [tab]: text })))
        .catch((err) => setError(String(err.message ?? err)));
    }
  }, [tab, id, xml]);

  return (
    <section className="card details">
      <div className="card-head">
        <h2>تفاصيل الفاتورة{detail ? `: ${detail.invoiceNumber}` : ''}</h2>
        <button className="btn ghost small" onClick={onClose}>إغلاق</button>
      </div>
      {error && <div className="alert danger"><strong>{error}</strong></div>}
      {!detail && !error && <p className="hint">جارٍ التحميل…</p>}
      {detail && <InvoiceDetailsView detail={detail} tab={tab} onTab={setTab} xml={xml} />}
    </section>
  );
}

interface ViewProps {
  detail: InvoiceDetail;
  tab: DetailsTab;
  onTab: (tab: DetailsTab) => void;
  xml: Partial<Record<'signed' | 'cleared', string>>;
}

/** العرض فقط (بدون تحميل) */
export function InvoiceDetailsView({ detail, tab, onTab, xml }: ViewProps) {
  const tabs: DetailsTab[] = ['summary', 'signed', ...(detail.hasClearedXml ? (['cleared'] as const) : []), 'response'];

  return (
    <div className="stack">
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {tab === 'summary' && (
        <div className="result-body">
          <div className="card-head">
            <span className={`badge ${STATUS_TONES[detail.status]}`}>{STATUS_LABELS[detail.status]}</span>
            {detail.httpStatus !== null && <span className="hint" dir="ltr">HTTP {detail.httpStatus}</span>}
          </div>

          {detail.status === 'PENDING' && (
            <div className="alert warning" data-pending>
              <strong>بانتظار الإرسال للهيئة</strong>
              <span>عدد المحاولات: <b dir="ltr">{detail.attempts}</b></span>
              {detail.nextRetryAt && <span>المحاولة التالية: {formatDate(detail.nextRetryAt)}</span>}
              {detail.lastError && <span>آخر خطأ: {detail.lastError}</span>}
            </div>
          )}

          <ZatcaMessages zatca={detail.zatcaResponse} />

          {detail.hasClearedXml ? (
            <p className="hint qr-note">الفاتورة معتمدة: رمز QR الرسمي داخل النسخة المعتمدة (تبويب «XML المعتمد»).</p>
          ) : (
            <QrFigure src={detail.qrImage} />
          )}

          <dl className="meta">
            <div><dt>النوع</dt><dd>{CATEGORY_LABELS[detail.category]} — {KIND_LABELS[detail.kind]}</dd></div>
            {detail.totalAmount !== null && (
              <>
                <div><dt>قبل الضريبة</dt><dd>{detail.netAmount !== null ? formatMoney(detail.netAmount) : '—'}</dd></div>
                <div><dt>الضريبة</dt><dd>{detail.vatAmount !== null ? formatMoney(detail.vatAmount) : '—'}</dd></div>
                <div><dt>الإجمالي</dt><dd><strong>{formatMoney(detail.totalAmount)}</strong></dd></div>
              </>
            )}
            {detail.originalInvoiceId && <div><dt>الفاتورة الأصلية</dt><dd dir="ltr">{detail.originalInvoiceId}</dd></div>}
            {detail.reason && <div><dt>السبب</dt><dd>{detail.reason}</dd></div>}
            <div><dt>العداد (ICV)</dt><dd dir="ltr">{detail.icv ?? '— (تجربة)'}</dd></div>
            {detail.submissionChannel && <div><dt>القناة</dt><dd>{detail.submissionChannel === 'clearance' ? 'اعتماد' : 'إبلاغ'}</dd></div>}
            <div>
              <dt>وقت الإصدار (الرياض)</dt>
              <dd title={`IssueDate ${detail.issueDate} — IssueTime ${detail.issueTime}`}>{formatIssueTime(detail.issueDate, detail.issueTime)}</dd>
            </div>
            {detail.submittedAt && <div><dt>رد الهيئة</dt><dd>{formatDate(detail.submittedAt)}</dd></div>}
            <div><dt>UUID</dt><dd dir="ltr" className="mono">{detail.uuid}</dd></div>
            <div><dt>التجزئة</dt><dd dir="ltr" className="mono">{detail.invoiceHash}</dd></div>
            {detail.pih && <div><dt>PIH</dt><dd dir="ltr" className="mono">{detail.pih}</dd></div>}
          </dl>
        </div>
      )}

      {(tab === 'signed' || tab === 'cleared') && (
        <>
          <a className="btn ghost small" href={api.xmlUrl(detail.id, { version: tab })} target="_blank" rel="noreferrer">
            فتح في نافذة جديدة
          </a>
          <pre dir="ltr" className="xml" data-xml={tab}>{xml[tab] ?? 'جارٍ التحميل…'}</pre>
        </>
      )}

      {tab === 'response' && (
        <pre dir="ltr" data-response>{detail.zatcaResponse ? JSON.stringify(detail.zatcaResponse, null, 2) : 'لا يوجد رد من الهيئة بعد'}</pre>
      )}
    </div>
  );
}
