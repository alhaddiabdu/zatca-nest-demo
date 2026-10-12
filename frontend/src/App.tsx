import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { MODE_COLORS } from './format';
import { InvoiceForm, Prefill } from './InvoiceForm';
import { InvoiceResult } from './InvoiceResult';
import { Onboarding } from './Onboarding';
import { CoreBanner, ModeBar } from './ModeBar';
import { ModeSelect } from './ModeSelect';
import { Dashboard } from './Dashboard';
import { EMPTY_FILTERS, InvoiceTable, TableFilters } from './InvoiceTable';
import { InvoiceDetails } from './InvoiceDetails';
import { SettingsPage } from './SettingsPage';
import { nextScreen, Screen } from './flow';
import type { InvoicePayload, InvoiceStatus, InvoiceSummary, IssueResult, Mode, Status } from './types';

type Tab = 'overview' | 'invoice' | 'history' | 'settings' | 'onboard';

export function App() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [active, setActive] = useState<Mode | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [last, setLast] = useState<{ payload: InvoicePayload; result: IssueResult; dryRun: boolean } | null>(null);
  const [tableFilters, setTableFilters] = useState<TableFilters>(EMPTY_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailsId, setDetailsId] = useState<string | null>(null);
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

  /** يعيد تحميل جدول الفواتير */
  const reloadTable = () => setReloadKey((k) => k + 1);

  /** يفتح جدول الفواتير على حالة معيّنة */
  const showInvoices = (status: InvoiceStatus | '' = '') => {
    setTableFilters({ ...EMPTY_FILTERS, status });
    setDetailsId(null);
    setTab('history');
  };

  useEffect(() => {
    resolveScreen();
  }, [resolveScreen]);

  const onModeSelected = (mode: Mode) => {
    setActive(mode);
    setLast(null);
    setTab('overview');
    setTableFilters(EMPTY_FILTERS);
    setDetailsId(null);
    resolveScreen();
  };

  const onIssued = (payload: InvoicePayload, result: IssueResult, dryRun: boolean) => {
    setLast({ payload, result, dryRun });
    refreshStatus();
    reloadTable();
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
      reloadTable();
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

      {screen === 'onboard' && <Onboarding status={status} onDone={resolveScreen} onShowPending={() => showInvoices('PENDING')} />}

      {screen === 'dashboard' && status && (
        <>
          <nav className="tabs" role="tablist">
            {([
              ['overview', 'نظرة عامة'],
              ['invoice', 'فاتورة جديدة'],
              ['history', 'الفواتير'],
              ['settings', 'الإعدادات'],
              ['onboard', 'التسجيل لدى الهيئة'],
            ] as [Tab, string][]).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </nav>

          <main>
            {tab === 'overview' && (
              <Dashboard
                status={status}
                onRetry={retryPending}
                retrying={retrying}
                retryMsg={retryMsg}
                onShowStatus={showInvoices}
              />
            )}

            {tab === 'invoice' && (
              <div className="invoice-layout">
                <InvoiceForm status={status} prefill={prefill} onIssued={onIssued} />
                {last ? (
                  <InvoiceResult
                    key={last.result.uuid}
                    {...last}
                    onOpenDetails={(id) => {
                      setDetailsId(id);
                      setTab('history');
                    }}
                  />
                ) : (
                  <section className="card empty">
                    <p>عبّئ الفاتورة واضغط «إنشاء» لترى التجزئة والتوقيع ورمز QR ورد الهيئة هنا.</p>
                  </section>
                )}
              </div>
            )}

            {tab === 'settings' && active && <SettingsPage key={active} mode={active} onSaved={() => refreshStatus()} />}

            {tab === 'onboard' && <Onboarding status={status} onDone={resolveScreen} onShowPending={() => showInvoices('PENDING')} />}

            {tab === 'history' && (
              <div className="stack">
                <InvoiceTable
                  filters={tableFilters}
                  onFiltersChange={setTableFilters}
                  reloadKey={reloadKey}
                  selectedId={detailsId}
                  onOpen={setDetailsId}
                  onNote={issueNote}
                />
                {detailsId && <InvoiceDetails key={detailsId} id={detailsId} onClose={() => setDetailsId(null)} />}
              </div>
            )}
          </main>
        </>
      )}
    </div>
  );
}
