import { api } from './api';
import { formatMoney, STATUS_LABELS, STATUS_TONES } from './format';
import type { InvoicePayload, IssueResult, ZatcaMessage } from './types';

interface Props {
  payload: InvoicePayload;
  result: IssueResult;
  dryRun: boolean;
}

function asList(m: ZatcaMessage[] | ZatcaMessage | undefined): ZatcaMessage[] {
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

export function InvoiceResult({ payload, result, dryRun }: Props) {
  const statusKey = dryRun ? 'DRY_RUN' : result.status ?? 'PENDING';
  const v = result.zatca?.validationResults;
  const errors = asList(v?.errorMessages);
  const warnings = asList(v?.warningMessages);

  return (
    <section className="card result">
      <div className="card-head">
        <h2>النتيجة: {payload.id}</h2>
        <span className={`badge ${STATUS_TONES[statusKey]}`}>{STATUS_LABELS[statusKey]}</span>
      </div>

      {(result.note || result.message) && <p className="hint">{result.note ?? result.message}</p>}

      <div className="result-body">
        {result.qrImage ? (
          <figure className="qr">
            <img src={result.qrImage} alt="رمز QR للفاتورة" />
            <figcaption>رمز QR (يُطبع على الفاتورة)</figcaption>
          </figure>
        ) : (
          !dryRun && result.status && result.status !== 'REJECTED' && payload.category === 'standard' && (
            <p className="hint qr-note">في الفاتورة القياسية تضع الهيئة رمز QR داخل النسخة المعتمدة (XML).</p>
          )
        )}

        <dl className="meta">
          {result.totals && (
            <>
              <div><dt>قبل الضريبة</dt><dd>{formatMoney(result.totals.net)}</dd></div>
              <div><dt>الضريبة</dt><dd>{formatMoney(result.totals.vat)}</dd></div>
              <div><dt>الإجمالي</dt><dd><strong>{formatMoney(result.totals.total)}</strong></dd></div>
            </>
          )}
          <div><dt>العداد (ICV)</dt><dd dir="ltr">{result.icv}</dd></div>
          {result.httpStatus && <div><dt>رد الهيئة</dt><dd dir="ltr">HTTP {result.httpStatus}</dd></div>}
          <div><dt>UUID</dt><dd dir="ltr" className="mono">{result.uuid}</dd></div>
          {result.invoiceHash && <div><dt>التجزئة</dt><dd dir="ltr" className="mono">{result.invoiceHash}</dd></div>}
        </dl>
      </div>

      {errors.length > 0 && (
        <div className="alert danger">
          <strong>أخطاء من الهيئة</strong>
          <ul>{errors.map((m, i) => <li key={i}><code>{m.code}</code> {m.message}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="alert warning">
          <strong>تحذيرات من الهيئة</strong>
          <ul>{warnings.map((m, i) => <li key={i}><code>{m.code}</code> {m.message}</li>)}</ul>
        </div>
      )}

      <div className="actions">
        {result.xmlPath && (
          <a className="btn ghost" href={api.xmlUrl(payload.id, dryRun)} target="_blank" rel="noreferrer">
            عرض XML الموقّع
          </a>
        )}
      </div>

      {result.zatca && (
        <details>
          <summary>رد الهيئة كاملاً</summary>
          <pre dir="ltr">{JSON.stringify({ ...result.zatca, clearedInvoice: result.zatca.clearedInvoice ? '…' : undefined }, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
