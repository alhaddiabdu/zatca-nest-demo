import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { CATEGORY_LABELS, formatDate, formatMoney, KIND_LABELS, MODE_COLORS, STATUS_LABELS, STATUS_TONES } from './format';
import { InvoiceForm, Prefill } from './InvoiceForm';
import { InvoiceResult } from './InvoiceResult';
import { Onboarding } from './Onboarding';
import { CoreBanner, ModeBar } from './ModeBar';
import { ModeSelect } from './ModeSelect';
import { SettingsPage } from './SettingsPage';
import { nextScreen, Screen } from './flow';
import type { InvoicePayload, InvoiceSummary, IssueResult, Mode, Status } from './types';

type Tab = 'invoice' | 'history' | 'settings' | 'onboard';

export function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [active, setActive] = useState<Mode | null>(null);
  const [tab, setTab] = useState<Tab>('invoice');
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [last, setLast] = useState<{ payload: InvoicePayload; result: IssueResult; dryRun: boolean } | null>(null);
  const [history, setHistory] = useState<InvoiceSummary[]>([]);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  /** يحدد الشاشة من الخادم: البطاقات ← الإعدادات ← التسجيل ← لوحة التحكم */
  const resolveScreen = useCallback(async () => {
    try {
      const { active: mode } = await api.mode();
      setActive(mode);
      if (!mode) {
        setStatus(null);
        setScreen(nextScreen(null, null, null));
        return;
      }
      const [settings, st] = await Promise.all([api.settings(mode), api.status()]);
      setStatus(st);
      setScreen(nextScreen(mode, settings, st));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'تعذر الاتصال بالخادم');
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.status());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'تعذر الاتصال بالخادم');
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory((await api.invoices({ includeDryRun: true, pageSize: 50 })).items);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    resolveScreen();
  }, [resolveScreen]);

  useEffect(() => {
    if (screen === 'dashboard') loadHistory();
  }, [screen, active, loadHistory]);

  const onModeSelected = (mode: Mode) => {
    setActive(mode);
    setLast(null);
    setTab('invoice');
    resolveScreen();
  };

  const onIssued = (payload: InvoicePayload, result: IssueResult, dryRun: boolean) => {
    setLast({ payload, result, dryRun });
    refreshStatus();
    loadHistory();
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
      refreshStatus();
      loadHistory();
    }
  };

  const issueNote = (item: InvoiceSummary, kind: 'credit' | 'debit') => {
    setPrefill({ kind, category: item.category, originalInvoiceId: item.invoiceNumber });
    setTab('invoice');
  };

  const color = active ? MODE_COLORS[active] : null;

  return (
    <div className={`app${color ? ` mode-${color}` : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>ف</div>
          <div>
            <h1>الفوترة الإلكترونية</h1>
            <p>الربط مع هيئة الزكاة والضريبة والجمارك — المرحلة الثانية</p>
          </div>
        </div>
        {screen !== 'modes' && <ModeBar mode={active} onChangeMode={() => setScreen('modes')} />}
      </header>
      <CoreBanner mode={screen === 'modes' ? null : active} />

      {loadError && (
        <div className="alert danger">
          <strong>{loadError}</strong>
          <button className="btn ghost small" onClick={resolveScreen}>إعادة المحاولة</button>
        </div>
      )}

      {screen === null && !loadError && <p className="hint">جارٍ التحميل…</p>}

      {screen === 'modes' && (
        <>
          {active && (
            <button className="link back-link" onClick={resolveScreen}>
              ← الرجوع للوضع الحالي دون تغيير
            </button>
          )}
          <ModeSelect onSelected={onModeSelected} />
        </>
      )}

      {screen === 'settings' && active && (
        <SettingsPage
          key={active}
          mode={active}
          onSaved={(s) => {
            if (s.complete) resolveScreen();
          }}
        />
      )}

      {screen === 'onboard' && <Onboarding status={status} onDone={resolveScreen} />}

      {screen === 'dashboard' && status && (
        <>
          <section className="status">
            <div className="stat">
              <span>المنشأة</span>
              <strong>{status.seller.name}</strong>
              <small dir="ltr">{status.seller.vatNumber}</small>
            </div>
            <div className="stat">
              <span>حالة الوحدة</span>
              <strong className={status.onboarded ? 'ok' : 'muted'}>{status.onboarded ? 'مسجّلة ✓' : 'غير مسجّلة'}</strong>
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

          <nav className="tabs" role="tablist">
            {([
              ['invoice', 'فاتورة جديدة'],
              ['history', `الفواتير (${history.length})`],
              ['settings', 'الإعدادات'],
              ['onboard', 'التسجيل لدى الهيئة'],
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

            {tab === 'settings' && active && <SettingsPage key={active} mode={active} onSaved={() => refreshStatus()} />}

            {tab === 'onboard' && <Onboarding status={status} onDone={resolveScreen} />}

            {tab === 'history' && (
              <section className="card">
                <div className="card-head">
                  <h2>آخر الفواتير</h2>
                  <button className="btn ghost small" onClick={loadHistory}>تحديث</button>
                </div>
                {history.length === 0 ? (
                  <p className="hint">لا توجد فواتير بعد في هذا الوضع.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>الرقم</th><th>النوع</th><th>الوثيقة</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h) => (
                          <tr key={h.id}>
                            <td dir="ltr" className="mono">{h.invoiceNumber}</td>
                            <td>{CATEGORY_LABELS[h.category]}</td>
                            <td>{KIND_LABELS[h.kind]}</td>
                            <td>{h.totalAmount != null ? formatMoney(h.totalAmount) : '—'}</td>
                            <td><span className={`badge ${STATUS_TONES[h.status]}`}>{STATUS_LABELS[h.status]}</span></td>
                            <td>{formatDate(h.createdAt)}</td>
                            <td className="row-actions">
                              <a href={api.xmlUrl(h.id)} target="_blank" rel="noreferrer">XML</a>
                              {!h.isDryRun && h.kind === 'invoice' && h.status !== 'REJECTED' && (
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
        </>
      )}
    </div>
  );
}
