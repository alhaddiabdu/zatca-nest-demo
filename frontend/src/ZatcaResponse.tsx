/** رسالة واحدة من رد الهيئة بعد توحيد شكلها */
interface Msg {
  code?: string;
  category?: string;
  message: string;
  status?: string;
}

type AnyObj = Record<string, unknown>;

const isObj = (v: unknown): v is AnyObj => v != null && typeof v === 'object' && !Array.isArray(v);

/** الهيئة ترسل الرسائل أحياناً مصفوفة وأحياناً كائناً واحداً أو نصاً */
function toMsgs(v: unknown): Msg[] {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : [v];
  return list.map((m) =>
    isObj(m)
      ? {
          code: (m.code ?? m.errorCode) as string | undefined,
          category: m.category as string | undefined,
          message: String(m.message ?? m.errorMessage ?? m.description ?? JSON.stringify(m)),
          status: m.status as string | undefined,
        }
      : { message: String(m) },
  );
}

/** يستخرج الأخطاء والتحذيرات والمعلومات من أي شكل لرد الهيئة */
export function parseZatcaBody(body: unknown) {
  if (typeof body === 'string') return { errors: body ? [{ message: body }] : [], warnings: [], infos: [], statuses: [] };
  const b = isObj(body) ? body : {};
  const v = isObj(b.validationResults) ? (b.validationResults as AnyObj) : {};
  const errors = [...toMsgs(v.errorMessages), ...toMsgs(b.errors)];
  // ردود الشهادات (CSID) قد تكون { code, message } أو { message } فقط، والنص غير JSON يصل في raw
  if (!errors.length && typeof b.raw === 'string' && b.raw) errors.push({ message: b.raw });
  if (!errors.length && !b.validationResults && (b.code || b.errorCode) && (b.message || b.errorMessage)) {
    errors.push(...toMsgs(b));
  }
  const statuses = (
    [
      ['التحقق', v.status],
      ['الإبلاغ', b.reportingStatus],
      ['الاعتماد', b.clearanceStatus],
      ['الحالة', b.dispositionMessage],
    ] as [string, unknown][]
  ).filter(([, s]) => typeof s === 'string' && s) as [string, string][];
  return { errors, warnings: toMsgs(v.warningMessages), infos: toMsgs(v.infoMessages), statuses };
}

/** لا تُعرض أسرار الشهادة ولا النسخة المعتمدة الطويلة في الرد الخام */
function redact(body: unknown): unknown {
  if (!isObj(body)) return body;
  const out: AnyObj = { ...body };
  for (const k of ['secret', 'binarySecurityToken']) if (k in out) out[k] = '***';
  if (typeof out.clearedInvoice === 'string') out.clearedInvoice = '…';
  return out;
}

const tone = (status: string) =>
  /^(PASS|REPORTED|CLEARED|ISSUED)$/i.test(status) ? 'success' : /WARN/i.test(status) ? 'warning' : /ERROR|NOT_/i.test(status) ? 'danger' : 'neutral';

function MsgList({ title, items, kind }: { title: string; items: Msg[]; kind: 'danger' | 'warning' | 'info' }) {
  if (!items.length) return null;
  return (
    <div className={`alert ${kind} zatca-msgs`}>
      <strong>
        {title} ({items.length})
      </strong>
      <ul>
        {items.map((m, i) => (
          <li key={i}>
            {m.code && <code dir="ltr">{m.code}</code>}
            {m.category && <small className="zatca-cat" dir="ltr">{m.category}</small>}
            <span dir="auto">{m.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  body: unknown;
  /** رمز HTTP من الهيئة */
  httpStatus?: number | null;
  /** إظهار الرد الخام JSON تحت التفاصيل (الافتراضي نعم) */
  showRaw?: boolean;
  /** إظهار رسائل المعلومات (infoMessages) */
  showInfo?: boolean;
}

/** رد الهيئة بشكل مقروء: رمز HTTP والحالة، ثم الأخطاء والتحذيرات، ثم الرد الخام */
export function ZatcaResponse({ body, httpStatus, showRaw = true, showInfo = false }: Props) {
  if (body == null && !httpStatus) return null;
  const { errors, warnings, infos, statuses } = parseZatcaBody(body);
  return (
    <div className="zatca-response">
      {(httpStatus || statuses.length > 0) && (
        <div className="zatca-statuses">
          {httpStatus ? (
            <span className={`badge ${httpStatus < 300 ? 'success' : httpStatus < 500 ? 'danger' : 'warning'}`} dir="ltr">
              HTTP {httpStatus}
            </span>
          ) : null}
          {statuses.map(([label, s]) => (
            <span key={label} className={`badge ${tone(s)}`}>
              {label}: <span dir="ltr">{s}</span>
            </span>
          ))}
        </div>
      )}
      <MsgList title="أخطاء من الهيئة" items={errors} kind="danger" />
      <MsgList title="تحذيرات من الهيئة" items={warnings} kind="warning" />
      {showInfo && <MsgList title="معلومات" items={infos} kind="info" />}
      {showRaw && body != null && (
        <details>
          <summary>رد الهيئة كاملاً (JSON)</summary>
          <pre dir="ltr">{typeof body === 'string' ? body : JSON.stringify(redact(body), null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
