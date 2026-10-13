import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';
import { BUYER_ID_LABELS, CATEGORY_LABELS, formatMoney, KIND_LABELS, round2 } from './format';
import type { BuyerIdScheme, Category, InvoicePayload, IssueResult, Kind, Status } from './types';

const VAT_RATE = 15;

interface LineRow {
  key: number;
  name: string;
  quantity: string;
  unitPrice: string;
}

interface BuyerState {
  name: string;
  vatNumber: string;
  otherIdType: BuyerIdScheme | '';
  otherIdValue: string;
  street: string;
  buildingNumber: string;
  district: string;
  city: string;
  postalCode: string;
}

const EMPTY_BUYER: BuyerState = { name: '', vatNumber: '', otherIdType: '', otherIdValue: '', street: '', buildingNumber: '', district: '', city: '', postalCode: '' };

const SAMPLE_BUYER: BuyerState = {
  name: 'مؤسسة العميل',
  vatNumber: '300000000000003',
  otherIdType: '',
  otherIdValue: '',
  street: 'طريق الملك فهد',
  buildingNumber: '1234',
  district: 'العليا',
  city: 'الرياض',
  postalCode: '12211',
};

let nextKey = 1;
const newLine = (name = '', quantity = '1', unitPrice = ''): LineRow => ({ key: nextKey++, name, quantity, unitPrice });

const newInvoiceId = () => `INV-${Date.now().toString().slice(-8)}`;

export interface Prefill {
  kind: Kind;
  category: Category;
  originalInvoiceId: string;
}

interface Props {
  status: Status | null;
  prefill: Prefill | null;
  onIssued: (payload: InvoicePayload, result: IssueResult, dryRun: boolean) => void;
}

export function InvoiceForm({ status, prefill, onIssued }: Props) {
  const [id, setId] = useState(newInvoiceId);
  const [category, setCategory] = useState<Category>('simplified');
  const [kind, setKind] = useState<Kind>('invoice');
  const [originalInvoiceId, setOriginalInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [buyer, setBuyer] = useState<BuyerState>(EMPTY_BUYER);
  const [lines, setLines] = useState<LineRow[]>(() => [newLine('قهوة عربية', '2', '15')]);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // قبل التسجيل لا يمكن الإرسال الفعلي، فنبقي وضع التجربة
  useEffect(() => {
    if (status) setDryRun(!status.onboarded);
  }, [status?.onboarded]);

  useEffect(() => {
    if (!prefill) return;
    setKind(prefill.kind);
    setCategory(prefill.category);
    setOriginalInvoiceId(prefill.originalInvoiceId);
    setId(newInvoiceId());
  }, [prefill]);

  const totals = useMemo(() => {
    const net = round2(lines.reduce((s, l) => s + round2(Number(l.quantity || 0) * Number(l.unitPrice || 0)), 0));
    const vat = round2((net * VAT_RATE) / 100);
    return { net, vat, total: round2(net + vat) };
  }, [lines]);

  const updateLine = (key: number, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const setBuyerField = (field: keyof BuyerState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setBuyer((b) => ({ ...b, [field]: e.target.value }));

  const buildPayload = (): InvoicePayload => {
    const payload: InvoicePayload = {
      id: id.trim(),
      category,
      kind,
      lines: lines.map((l) => ({ name: l.name.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    };
    if (kind !== 'invoice') {
      payload.originalInvoiceId = originalInvoiceId.trim();
      payload.reason = reason.trim();
    }
    const hasAddress = buyer.street || buyer.buildingNumber || buyer.district || buyer.city || buyer.postalCode;
    if (category === 'standard' || buyer.name.trim()) {
      payload.buyer = { name: buyer.name.trim() };
      if (buyer.vatNumber.trim()) payload.buyer.vatNumber = buyer.vatNumber.trim();
      if (buyer.otherIdType && buyer.otherIdValue.trim()) {
        payload.buyer.otherIdType = buyer.otherIdType;
        payload.buyer.otherIdValue = buyer.otherIdValue.trim();
      }
      if (category === 'standard' || hasAddress) {
        payload.buyer.address = {
          street: buyer.street.trim(),
          buildingNumber: buyer.buildingNumber.trim(),
          district: buyer.district.trim(),
          city: buyer.city.trim(),
          postalCode: buyer.postalCode.trim(),
        };
      }
    }
    return payload;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = buildPayload();
    try {
      const result = await api.issue(payload, dryRun);
      onIssued(payload, result, dryRun);
      if (!dryRun) {
        setId(newInvoiceId());
        if (kind !== 'invoice') {
          setKind('invoice');
          setOriginalInvoiceId('');
          setReason('');
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0, null));
    } finally {
      setBusy(false);
    }
  };

  const canSend = status?.onboarded ?? false;

  return (
    <form className="card form" onSubmit={submit}>
      <div className="card-head">
        <h2>فاتورة جديدة</h2>
      </div>

      <div className="grid-3">
        <label className="field">
          <span>رقم الفاتورة</span>
          <input value={id} onChange={(e) => setId(e.target.value)} required dir="ltr" />
        </label>
        <div className="field">
          <span>نوع الفاتورة</span>
          <div className="segmented">
            {(['simplified', 'standard'] as Category[]).map((c) => (
              <button type="button" key={c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>الوثيقة</span>
          <div className="segmented">
            {(['invoice', 'credit', 'debit'] as Kind[]).map((k) => (
              <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="hint">
        {category === 'simplified'
          ? 'المبسطة للأفراد: تُرسل للهيئة بالإبلاغ (Reporting) خلال 24 ساعة.'
          : 'القياسية للمنشآت: تُرسل للاعتماد (Clearance) قبل تسليمها للعميل، وتتطلب بيانات المشتري.'}
      </p>

      {kind !== 'invoice' && (
        <fieldset>
          <legend>بيانات {KIND_LABELS[kind]}</legend>
          <div className="grid-2">
            <label className="field">
              <span>رقم الفاتورة الأصلية</span>
              <input value={originalInvoiceId} onChange={(e) => setOriginalInvoiceId(e.target.value)} required dir="ltr" />
            </label>
            <label className="field">
              <span>سبب الإشعار</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="مثل: إرجاع بضاعة" />
            </label>
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend>
          المشتري {category === 'simplified' && <small>(اختياري)</small>}
          {category === 'standard' && (
            <button type="button" className="link" onClick={() => setBuyer(SAMPLE_BUYER)}>
              تعبئة ببيانات تجريبية
            </button>
          )}
        </legend>
        <div className="grid-2">
          <label className="field">
            <span>الاسم</span>
            <input value={buyer.name} onChange={setBuyerField('name')} required={category === 'standard'} />
          </label>
          <label className="field">
            <span>الرقم الضريبي</span>
            <input
              value={buyer.vatNumber}
              onChange={setBuyerField('vatNumber')}
              dir="ltr"
              inputMode="numeric"
              pattern="3\d{13}3"
              title="15 رقماً يبدأ وينتهي بـ 3"
              placeholder="3xxxxxxxxxxxxx3"
            />
          </label>
          <label className="field">
            <span>معرّف بديل للمشتري {category === 'standard' && !buyer.vatNumber.trim() ? <small>(إلزامي بدون رقم ضريبي)</small> : <small>(اختياري)</small>}</span>
            <select
              value={buyer.otherIdType}
              onChange={setBuyerField('otherIdType')}
              required={(category === 'standard' && !buyer.vatNumber.trim()) || !!buyer.otherIdValue.trim()}
            >
              <option value="">— النوع —</option>
              {(Object.keys(BUYER_ID_LABELS) as BuyerIdScheme[]).map((k) => (
                <option key={k} value={k}>{BUYER_ID_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>رقم المعرّف</span>
            <input
              value={buyer.otherIdValue}
              onChange={setBuyerField('otherIdValue')}
              required={(category === 'standard' && !buyer.vatNumber.trim()) || !!buyer.otherIdType}
              pattern="[A-Za-z0-9]+"
              title="أحرف وأرقام فقط"
              dir="ltr"
            />
          </label>
        </div>
        {category === 'standard' && (
          <p className="hint">الفاتورة القياسية وإشعاراتها تتطلب رقماً ضريبياً للمشتري، أو معرّفاً بديلاً (قاعدة BR-KSA-81).</p>
        )}
        {category === 'standard' && (
          <div className="grid-5">
            <label className="field">
              <span>الشارع</span>
              <input value={buyer.street} onChange={setBuyerField('street')} required />
            </label>
            <label className="field">
              <span>رقم المبنى</span>
              <input value={buyer.buildingNumber} onChange={setBuyerField('buildingNumber')} required pattern="\d{4}" title="4 أرقام" dir="ltr" inputMode="numeric" />
            </label>
            <label className="field">
              <span>الحي</span>
              <input value={buyer.district} onChange={setBuyerField('district')} required />
            </label>
            <label className="field">
              <span>المدينة</span>
              <input value={buyer.city} onChange={setBuyerField('city')} required />
            </label>
            <label className="field">
              <span>الرمز البريدي</span>
              <input value={buyer.postalCode} onChange={setBuyerField('postalCode')} required pattern="\d{5}" title="5 أرقام" dir="ltr" inputMode="numeric" />
            </label>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>البنود</legend>
        <div className="lines">
          <div className="line line-head">
            <span>الصنف</span>
            <span>الكمية</span>
            <span>سعر الوحدة (قبل الضريبة)</span>
            <span>المبلغ</span>
            <span />
          </div>
          {lines.map((l) => (
            <div className="line" key={l.key}>
              <input aria-label="الصنف" value={l.name} onChange={(e) => updateLine(l.key, { name: e.target.value })} required placeholder="اسم الصنف" />
              <input aria-label="الكمية" type="number" min="0.01" step="any" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} required dir="ltr" />
              <input aria-label="سعر الوحدة" type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} required dir="ltr" />
              <span className="amount">{formatMoney(round2(Number(l.quantity || 0) * Number(l.unitPrice || 0)))}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="حذف البند"
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn ghost" onClick={() => setLines((ls) => [...ls, newLine()])}>
          + إضافة بند
        </button>

        <dl className="totals">
          <div><dt>الإجمالي قبل الضريبة</dt><dd>{formatMoney(totals.net)}</dd></div>
          <div><dt>ضريبة القيمة المضافة ({VAT_RATE}%)</dt><dd>{formatMoney(totals.vat)}</dd></div>
          <div className="grand"><dt>الإجمالي</dt><dd>{formatMoney(totals.total)}</dd></div>
        </dl>
      </fieldset>

      <div className="submit-row">
        <label className={`toggle ${!canSend ? 'locked' : ''}`}>
          <input type="checkbox" checked={dryRun} disabled={!canSend} onChange={(e) => setDryRun(e.target.checked)} />
          <span>
            تجربة فقط بدون إرسال للهيئة
            {!canSend && <small> — سجّل الوحدة أولاً لتتمكن من الإرسال الفعلي</small>}
          </span>
        </label>
        <button className="btn primary mode-submit" disabled={busy}>
          {busy
            ? 'جارٍ المعالجة…'
            : dryRun
              ? 'إنشاء وتوقيع (تجربة)'
              : status?.env === 'core'
                ? 'إصدار فاتورة رسمية'
                : 'إصدار وإرسال للهيئة'}
        </button>
      </div>

      {error && (
        <div className="alert danger" role="alert">
          <strong>{error.message}</strong>
          {error.body != null && typeof error.body === 'object' && (
            <details>
              <summary>التفاصيل</summary>
              <pre dir="ltr">{JSON.stringify(error.body, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </form>
  );
}
