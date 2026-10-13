import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { CATEGORY_LABELS, formatIssueTime, formatMoney, KIND_LABELS, STATUS_LABELS, STATUS_TONES } from './format';
import type { Category, InvoiceQuery, InvoiceStatus, InvoiceSummary, Kind, Page } from './types';

export const PAGE_SIZE = 20;

/** فلاتر الجدول (تُحفظ في App حتى تبقى بعد فتح التفاصيل وتغيير التبويب) */
export interface TableFilters {
  status: InvoiceStatus | '';
  category: Category | '';
  kind: Kind | '';
  q: string;
  from: string;
  to: string;
  includeDryRun: boolean;
  page: number;
}

export const EMPTY_FILTERS: TableFilters = { status: '', category: '', kind: '', q: '', from: '', to: '', includeDryRun: false, page: 1 };

/** الفلاتر ← معاملات GET /zatca/invoices */
export function toApiQuery(f: TableFilters): InvoiceQuery {
  return {
    status: f.status || undefined,
    category: f.category || undefined,
    kind: f.kind || undefined,
    q: f.q.trim() || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    includeDryRun: f.includeDryRun || undefined,
    page: f.page,
    pageSize: PAGE_SIZE,
  };
}

interface Props {
  filters: TableFilters;
  onFiltersChange: (filters: TableFilters) => void;
  /** يتغير بعد إصدار فاتورة أو إعادة إرسال، فيُعاد التحميل */
  reloadKey: number;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onNote: (item: InvoiceSummary, kind: 'credit' | 'debit') => void;
}

/** جدول الفواتير من الخادم مع الفلترة والترقيم */
export function InvoiceTable({ filters, onFiltersChange, reloadKey, selectedId, onOpen, onNote }: Props) {
  const [data, setData] = useState<Page<InvoiceSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState(filters.q);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .invoices(toApiQuery(filters))
      .then((page) => {
        if (!cancelled) {
          setData(page);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey]);

  // أي تغيير في الفلاتر يعيد للصفحة الأولى
  const change = (patch: Partial<TableFilters>) => onFiltersChange({ ...filters, ...patch, page: 1 });
  const search = (e: FormEvent) => {
    e.preventDefault();
    change({ q });
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>الفواتير</h2>
        {loading && <span className="hint">جارٍ التحميل…</span>}
      </div>

      <form className="filters" onSubmit={search}>
        <select aria-label="الحالة" value={filters.status} onChange={(e) => change({ status: e.target.value as TableFilters['status'] })}>
          <option value="">كل الحالات</option>
          {(['ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'REJECTED', 'PENDING', 'DRY_RUN'] as InvoiceStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select aria-label="النوع" value={filters.category} onChange={(e) => change({ category: e.target.value as TableFilters['category'] })}>
          <option value="">كل الأنواع</option>
          <option value="simplified">{CATEGORY_LABELS.simplified}</option>
          <option value="standard">{CATEGORY_LABELS.standard}</option>
        </select>
        <select aria-label="الوثيقة" value={filters.kind} onChange={(e) => change({ kind: e.target.value as TableFilters['kind'] })}>
          <option value="">كل الوثائق</option>
          {(['invoice', 'credit', 'debit'] as Kind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
        <label className="filter-date">
          <span>من</span>
          <input type="date" value={filters.from} onChange={(e) => change({ from: e.target.value })} />
        </label>
        <label className="filter-date">
          <span>إلى</span>
          <input type="date" value={filters.to} onChange={(e) => change({ to: e.target.value })} />
        </label>
        <input
          className="filter-search"
          placeholder="رقم الفاتورة أو UUID"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          dir="ltr"
          aria-label="بحث"
        />
        <button className="btn ghost small" type="submit">بحث</button>
        <label className="toggle filter-dry">
          <input type="checkbox" checked={filters.includeDryRun} onChange={(e) => change({ includeDryRun: e.target.checked })} />
          <span>إظهار فواتير التجربة</span>
        </label>
        {JSON.stringify({ ...filters, page: 1 }) !== JSON.stringify(EMPTY_FILTERS) && (
          <button
            type="button"
            className="link"
            onClick={() => {
              setQ('');
              onFiltersChange(EMPTY_FILTERS);
            }}
          >
            مسح الفلاتر
          </button>
        )}
      </form>

      {error && <div className="alert danger"><strong>{error}</strong></div>}

      {data && (
        <InvoiceTableView
          page={data}
          selectedId={selectedId}
          onOpen={onOpen}
          onNote={onNote}
          onPage={(page) => onFiltersChange({ ...filters, page })}
        />
      )}
    </section>
  );
}

interface ViewProps {
  page: Page<InvoiceSummary>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onNote: (item: InvoiceSummary, kind: 'credit' | 'debit') => void;
  onPage: (page: number) => void;
}

/** الصفوف والترقيم فقط (بدون تحميل)، بنفس أعمدة السجل السابق */
export function InvoiceTableView({ page, selectedId, onOpen, onNote, onPage }: ViewProps) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  if (page.total === 0) return <p className="hint">لا توجد فواتير تطابق الفلاتر.</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="table invoices-table">
          <thead>
            <tr>
              <th>الرقم</th><th>ICV</th><th>النوع</th><th>الوثيقة</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th><th />
            </tr>
          </thead>
          <tbody>
            {page.items.map((h) => (
              <tr
                key={h.id}
                className={`clickable${h.id === selectedId ? ' selected' : ''}`}
                onClick={() => onOpen(h.id)}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(h.id)}
              >
                <td dir="ltr" className="mono">{h.invoiceNumber}</td>
                <td dir="ltr">{h.icv ?? '—'}</td>
                <td>{CATEGORY_LABELS[h.category]}</td>
                <td>{KIND_LABELS[h.kind]}</td>
                <td>{h.totalAmount != null ? formatMoney(h.totalAmount) : '—'}</td>
                <td>
                  <span className={`badge ${STATUS_TONES[h.status]}`} data-row-status={h.status}>{STATUS_LABELS[h.status]}</span>
                  {h.status === 'PENDING' && h.attempts > 0 && <small className="row-note"> محاولة {h.attempts}</small>}
                </td>
                <td>{formatIssueTime(h.issueDate, h.issueTime)}</td>
                <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <a href={api.xmlUrl(h.id)} target="_blank" rel="noreferrer">XML</a>
                  {!h.isDryRun && h.kind === 'invoice' && h.status !== 'REJECTED' && (
                    <>
                      <button className="link" onClick={() => onNote(h, 'credit')}>إشعار دائن</button>
                      <button className="link" onClick={() => onNote(h, 'debit')}>إشعار مدين</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn ghost small" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>السابق</button>
        <span className="hint" data-pager>صفحة {page.page} من {pages} — {page.total} فاتورة</span>
        <button className="btn ghost small" disabled={page.page >= pages} onClick={() => onPage(page.page + 1)}>التالي</button>
      </div>
    </>
  );
}
