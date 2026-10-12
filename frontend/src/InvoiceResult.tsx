import { formatMoney, STATUS_LABELS, STATUS_TONES } from './format';
import type { InvoicePayload, IssueResult, ZatcaBody, ZatcaMessage } from './types';

interface Props {
  payload: InvoicePayload;
  result: IssueResult;
  dryRun: boolean;
  /** يفتح تفاصيل الفاتورة (XML و QR ورد الهيئة) في جدول الفواتير */
  onOpenDetails?: (invoiceId: string) => void;
}

function asList(m: ZatcaMessage[] | ZatcaMessage | undefined): ZatcaMessage[] {
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

/** أخطاء وتحذيرات الهيئة من validationResults */
export function ZatcaMessages({ zatca }: { zatca?: ZatcaBody | null }) {
  const v = zatca?.validationResults;
  const errors = asList(v?.errorMessages);
  const warnings = asList(v?.warningMessages);
  return (
    <>
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
    </>
  );
}

/** صورة رمز QR */
export function QrFigure({ src, caption = 'رمز QR (يُطبع على الفاتورة)' }: { src: string; caption?: string }) {
  return (
    <figure className="qr">
      <img src={src} alt="رمز QR للفاتورة" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function InvoiceResult({ payload, result, dryRun, onOpenDetails }: Props) {
  const statusKey = dryRun ? 'DRY_RUN' : result.status ?? 'PENDING';

  return (
    <section className="card result">
      <div className="card-head">
        <h2>النتيجة: {payload.id}</h2>
        <span className={`badge ${STATUS_TONES[statusKey]}`}>{STATUS_LABELS[statusKey]}</span>
      </div>

      {(result.note || result.message) && <p className="hint">{result.note ?? result.message}</p>}

      <div className="result-body">
        {result.qrImage ? (
          <QrFigure src={result.qrImage} />
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

      <ZatcaMessages zatca={result.zatca} />

      <div className="actions">
        {result.invoiceId && onOpenDetails && (
          <button type="button" className="btn ghost" onClick={() => onOpenDetails(result.invoiceId!)}>
            فتح التفاصيل
          </button>
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
