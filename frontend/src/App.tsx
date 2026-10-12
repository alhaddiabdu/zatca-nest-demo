import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { CATEGORY_LABELS, formatDate, formatMoney, KIND_LABELS, MODE_COLORS, STATUS_LABELS, STATUS_TONES } from './format';
import { InvoiceForm, Prefill } from './InvoiceForm';
import { InvoiceResult } from './InvoiceResult';
import { Onboarding } from './Onboarding';
import { CoreBanner, ModeBar } from './ModeBar';
import type { HistoryItem, InvoicePayload, IssueResult, Status } from './types';

type Tab = 'invoice' | 'onboard' | 'history';

const HISTORY_KEY = 'zatca-demo-history';

function loadHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // التخزين غير متاح، السجل يبقى في هذه الجلسة فقط
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>('invoice');
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [last, setLast] = useState<{ payload: InvoicePayload; result: IssueResult; dryRun: boolean } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : 'تعذر الاتصال بالخادم');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onIssued = (payload: InvoicePayload, result: IssueResult, dryRun: boolean) => {
    setLast({ payload, result, dryRun });
    const item: HistoryItem = {
      id: payload.id,
      category: payload.category,
      kind: payload.kind,
      status: dryRun ? 'DRY_RUN' : result.status ?? 'PENDING',
      total: result.totals?.total,
      issuedAt: new Date().toISOString(),
      dryRun,
    };
    setHistory((h) => {
      const next = [item, ...h].slice(0, 100);
      saveHistory(next);
      return next;
    });
    refresh();
  };

  const retryPending = async () => {
    setRetrying(true);
    setRetryMsg(null);
    try {
      const r = await api.retryPending();
      setRetryMsg(`أُرسلت ${r.sent.length}، وبقي ${r.stillPending} معلّقة`);
    } catch (err) {
      setRetryMsg(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRetrying(false);
      refresh();
    }
  };

  const issueNote = (item: HistoryItem, kind: 'credit' | 'debit') => {
    setPrefill({ kind, category: item.category, originalInvoiceId: item.id });
    setTab('invoice');
  };

  return (
    <div className={`app${status ? ` mode-${MODE_COLORS[status.env]}` : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>ف</div>
          <div>
            <h1>الفوترة الإلكترونية</h1>
            <p>الربط مع هيئة الزكاة والضريبة والجمارك — المرحلة الثانية</p>
          </div>
        </div>
        <ModeBar mode={status?.env ?? null} />
      </header>
      <CoreBanner mode={status?.env ?? null} />

      {statusError && (
        <div className="alert danger">
          <strong>{statusError}</strong>
          <button className="btn ghost small" onClick={refresh}>إعادة المحاولة</button>
        </div>
      )}

      {status && (
        <section className="status">
          <div className="stat">
            <span>المنشأة</span>
            <strong>{status.seller.name}</strong>
            <small dir="ltr">{status.seller.vatNumber}</small>
          </div>
          <div className="stat">
            <span>حالة الوحدة</span>
            <strong className={status.onboarded ? 'ok' : 'muted'}>{status.onboarded ? 'مسجّلة ✓' : 'غير مسجّلة'}</strong>
            {!status.onboarded && (
              <button className="link" onClick={() => setTab('onboard')}>سجّل الآن</button>
            )}
          </div>
          <div className="stat">
            <span>عدد الفواتير المُصدرة (ICV)</span>
            <strong dir="ltr">{status.chain.icv}</strong>
          </div>
          <div className="stat">
            <span>معلّقة للإرسال</span>
            <strong dir="ltr">{status.pendingCount}</strong>
            {status.pendingCount > 0 && (
              <button className="link" onClick={retryPending} disabled={retrying}>
                {retrying ? 'جارٍ الإرسال…' : 'إعادة الإرسال'}
              </button>
            )}
            {retryMsg && <small>{retryMsg}</small>}
          </div>
        </section>
      )}

      <nav className="tabs" role="tablist">
        {([
          ['invoice', 'فاتورة جديدة'],
          ['onboard', 'التسجيل لدى الهيئة'],
          ['history', `السجل (${history.length})`],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'invoice' && (
          <div className="invoice-layout">
            <InvoiceForm status={status} prefill={prefill} onIssued={onIssued} />
            {last ? (
              <InvoiceResult key={last.result.uuid} {...last} />
            ) : (
              <section className="card empty">
                <p>عبّئ الفاتورة واضغط «إنشاء» لترى التجزئة والتوقيع ورمز QR ورد الهيئة هنا.</p>
              </section>
            )}
          </div>
        )}

        {tab === 'onboard' && <Onboarding status={status} onDone={refresh} />}

        {tab === 'history' && (
          <section className="card">
            <div className="card-head">
              <h2>سجل الفواتير</h2>
              {history.length > 0 && (
                <button
                  className="btn ghost small"
                  onClick={() => {
                    setHistory([]);
                    saveHistory([]);
                  }}
                >
                  مسح السجل
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="hint">لا توجد فواتير بعد.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الرقم</th><th>النوع</th><th>الوثيقة</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={`${h.id}-${i}`}>
                        <td dir="ltr" className="mono">{h.id}</td>
                        <td>{CATEGORY_LABELS[h.category]}</td>
                        <td>{KIND_LABELS[h.kind]}</td>
                        <td>{h.total != null ? formatMoney(h.total) : '—'}</td>
                        <td><span className={`badge ${STATUS_TONES[h.status]}`}>{STATUS_LABELS[h.status]}</span></td>
                        <td>{formatDate(h.issuedAt)}</td>
                        <td className="row-actions">
                          <a href={api.xmlUrl(h.id, { dryRun: h.dryRun })} target="_blank" rel="noreferrer">XML</a>
                          {!h.dryRun && h.kind === 'invoice' && h.status !== 'REJECTED' && (
                            <>
                              <button className="link" onClick={() => issueNote(h, 'credit')}>إشعار دائن</button>
                              <button className="link" onClick={() => issueNote(h, 'debit')}>إشعار مدين</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
