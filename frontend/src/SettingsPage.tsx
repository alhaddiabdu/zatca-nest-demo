import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';
import { ENV_LABELS } from './format';
import type { EgsSettings, EnvSettings, Mode, Seller } from './types';

type Group = 'seller' | 'egs';
type Values = { seller: Seller; egs: EgsSettings };
type Errors = Record<string, string>;

interface FieldDef {
  key: string;
  label: string;
  max: number;
  /** نمط ورسالته (مطابقة لرسائل الخادم حرفياً) */
  pattern?: [RegExp, string];
  /** يُكتب داخل الـ CSR: يُمنع فيه سطر جديد و = | [ ] $ */
  csr?: boolean;
  ltr?: boolean;
  numeric?: boolean;
  options?: Array<[string, string]>;
  hint?: string;
}

const CSR_SAFE = /^[^\r\n=|[\]$]+$/;

const FIELDS: Record<Group, FieldDef[]> = {
  seller: [
    { key: 'name', label: 'اسم المنشأة', max: 200, csr: true },
    { key: 'vatNumber', label: 'الرقم الضريبي', max: 15, pattern: [/^3\d{13}3$/, 'الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3'], ltr: true, numeric: true },
    { key: 'crn', label: 'السجل التجاري', max: 10, pattern: [/^\d{10}$/, 'السجل التجاري 10 أرقام'], ltr: true, numeric: true },
    { key: 'street', label: 'الشارع', max: 200 },
    { key: 'buildingNumber', label: 'رقم المبنى', max: 4, pattern: [/^\d{4}$/, 'رقم المبنى 4 أرقام'], ltr: true, numeric: true },
    { key: 'district', label: 'الحي', max: 100 },
    { key: 'city', label: 'المدينة', max: 100 },
    { key: 'postalCode', label: 'الرمز البريدي', max: 5, pattern: [/^\d{5}$/, 'الرمز البريدي 5 أرقام'], ltr: true, numeric: true },
  ],
  egs: [
    { key: 'commonName', label: 'الاسم الشائع (CN)', max: 64, csr: true, ltr: true },
    { key: 'orgUnit', label: 'الفرع (OU)', max: 64, csr: true },
    { key: 'solutionName', label: 'اسم الحل', max: 64, csr: true, ltr: true },
    { key: 'model', label: 'الطراز', max: 64, csr: true, ltr: true },
    { key: 'serial', label: 'الرقم التسلسلي', max: 64, csr: true, ltr: true },
    {
      key: 'invoiceType', label: 'أنواع الفواتير', max: 4,
      options: [['1100', 'قياسية ومبسطة (1100)'], ['1000', 'قياسية فقط (1000)'], ['0100', 'مبسطة فقط (0100)']],
    },
    { key: 'location', label: 'الموقع', max: 64, csr: true, ltr: true },
    { key: 'industry', label: 'النشاط', max: 64, csr: true, ltr: true },
  ],
};

const GROUP_TITLES: Record<Group, string> = { seller: 'بيانات المنشأة (البائع)', egs: 'وحدة إصدار الفواتير (EGS)' };

/** القيم التجريبية لبوابة المطورين (نفس بذور قاعدة البيانات) */
export const DEV_DEFAULTS: Values = {
  seller: {
    name: 'شركة التجربة المحدودة', vatNumber: '399999999900003', crn: '1010010000', street: 'الأمير سلطان',
    buildingNumber: '2322', district: 'المربع', city: 'الرياض', postalCode: '23333',
  },
  egs: {
    commonName: 'TST-886431145-399999999900003', orgUnit: 'Riyadh Branch', solutionName: 'MyERP', model: 'NestDemo',
    serial: 'ed22f1d8-e6a2-1118-9b58-d9a8f11e445f', invoiceType: '1100', location: 'RRRD2929', industry: 'Supply activities',
  },
};

/** نفس قواعد الخادم ونفس رسائله (settings.dto.ts) */
function messagesFor(group: Group, f: FieldDef): { required: string; length: string; csr?: string } {
  if (group === 'seller') {
    const required = f.key === 'city' ? 'المدينة مطلوبة' : `${f.label} مطلوب`;
    return { required, length: `${f.label} من 1 إلى ${f.max} حرف`, csr: f.csr ? `${f.label}: لا يُسمح بالأسطر الجديدة ولا بالرموز = | [ ] $` : undefined };
  }
  return { required: `${f.label} مطلوب`, length: `${f.label} من 1 إلى 64 حرفاً`, csr: f.csr ? `${f.label}: لا يُسمح بالأسطر الجديدة ولا بالرموز = | [ ] $` : undefined };
}

export function validate(values: Values): Errors {
  const errors: Errors = {};
  for (const group of ['seller', 'egs'] as const) {
    for (const f of FIELDS[group]) {
      const value = ((values[group] as unknown as Record<string, string>)[f.key] ?? '').trim();
      const msg = messagesFor(group, f);
      const path = `${group}.${f.key}`;
      if (f.pattern) {
        if (!f.pattern[0].test(value)) errors[path] = f.pattern[1];
      } else if (f.options) {
        if (!f.options.some(([v]) => v === value)) errors[path] = 'نوع الفواتير: 1100 (الاثنان) أو 1000 (قياسية) أو 0100 (مبسطة)';
      } else if (!value) {
        errors[path] = msg.required;
      } else if (value.length > f.max) {
        errors[path] = msg.length;
      } else if (f.csr && !CSR_SAFE.test(value)) {
        errors[path] = msg.csr!;
      }
    }
  }
  return errors;
}

/** يربط رسالة خطأ من الخادم بحقلها (الرسائل متطابقة) */
export function fieldOfServerMessage(message: string): string | null {
  for (const group of ['seller', 'egs'] as const) {
    for (const f of FIELDS[group]) {
      const m = messagesFor(group, f);
      const candidates = [f.pattern?.[1], m.required, m.length, m.csr].filter(Boolean);
      if (candidates.includes(message) || (f.options && message.startsWith('نوع الفواتير'))) return `${group}.${f.key}`;
    }
  }
  return null;
}

interface Props {
  mode: Mode;
  /** بعد الحفظ الناجح */
  onSaved: (settings: EnvSettings) => void;
}

/** صفحة إعدادات المنشأة ووحدة الإصدار لوضع معيّن */
export function SettingsPage({ mode, onSaved }: Props) {
  const [loaded, setLoaded] = useState<EnvSettings | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoaded(null);
    api
      .settings(mode)
      .then((s) => {
        setLoaded(s);
        setValues({ seller: s.seller, egs: s.egs });
      })
      .catch((err) => setFormError(err instanceof ApiError ? err.message : String(err)));
  }, [mode]);

  const locked = useMemo(() => new Set(loaded?.lockedFields ?? []), [loaded]);

  if (!values || !loaded) {
    return <section className="card">{formError ? <div className="alert danger">{formError}</div> : <p className="hint">جارٍ التحميل…</p>}</section>;
  }

  const set = (group: Group, key: string, value: string) => {
    setSaved(false);
    setValues((v) => (v ? { ...v, [group]: { ...v[group], [key]: value } } : v));
    // تحقق فوري للحقل بعد أول محاولة حفظ أو أثناء الكتابة
    setErrors((e) => {
      const next = { ...e };
      const path = `${group}.${key}`;
      const fieldErrors = validate({ ...values, [group]: { ...values[group], [key]: value } } as Values);
      if (fieldErrors[path]) next[path] = fieldErrors[path];
      else delete next[path];
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaved(false);
    const clientErrors = validate(values);
    setErrors(clientErrors);
    // لا إرسال للخادم مع أخطاء معروفة
    if (Object.keys(clientErrors).length) return;
    setBusy(true);
    try {
      const result = await api.saveSettings(mode, values);
      setLoaded(result);
      setValues({ seller: result.seller, egs: result.egs });
      setSaved(true);
      onSaved(result);
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string | string[]; fields?: string[]; code?: string } | null;
        const serverErrors: Errors = {};
        const unmapped: string[] = [];
        for (const m of Array.isArray(body?.message) ? body!.message : []) {
          const field = fieldOfServerMessage(m);
          if (field) serverErrors[field] = m;
          else unmapped.push(m);
        }
        if (body?.code === 'FIELDS_LOCKED') {
          for (const f of body.fields ?? []) serverErrors[f] = 'مقفل بعد التسجيل';
        }
        setErrors(serverErrors);
        setFormError(unmapped.length ? unmapped.join('، ') : err.message);
      } else {
        setFormError(String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const restoreDevDefaults = () => {
    setValues(DEV_DEFAULTS);
    setErrors({});
    setSaved(false);
  };

  return (
    <form className="card form settings" onSubmit={submit} noValidate>
      <div className="card-head">
        <h2>إعدادات المنشأة — {ENV_LABELS[mode]}</h2>
        {mode === 'developer-portal' && locked.size === 0 && (
          <button type="button" className="btn ghost small" onClick={restoreDevDefaults}>
            استعادة القيم التجريبية
          </button>
        )}
      </div>
      {locked.size > 0 && (
        <p className="hint">الوحدة مسجّلة: الحقول المكتوبة داخل الشهادة مقفلة، ولتغييرها أعد التسجيل. العنوان والسجل التجاري قابلان للتعديل.</p>
      )}
      {mode === 'developer-portal' && <p className="hint">قيم تجريبية جاهزة لبوابة المطورين، يمكنك تغييرها.</p>}

      {(['seller', 'egs'] as const).map((group) => (
        <fieldset key={group}>
          <legend>{GROUP_TITLES[group]}</legend>
          <div className="grid-2">
            {FIELDS[group].map((f) => {
              const path = `${group}.${f.key}`;
              const value = (values[group] as unknown as Record<string, string>)[f.key] ?? '';
              const isLocked = locked.has(path);
              const error = errors[path];
              const common = {
                id: path,
                value,
                disabled: isLocked || busy,
                'aria-invalid': !!error,
                'aria-describedby': error ? `${path}-error` : undefined,
              };
              return (
                <label key={path} className={`field${error ? ' has-error' : ''}`} htmlFor={path}>
                  <span>{f.label}</span>
                  {f.options ? (
                    <select {...common} onChange={(e) => set(group, f.key, e.target.value)}>
                      {f.options.map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      {...common}
                      onChange={(e) => set(group, f.key, e.target.value)}
                      dir={f.ltr ? 'ltr' : undefined}
                      inputMode={f.numeric ? 'numeric' : undefined}
                      maxLength={f.max + 10}
                    />
                  )}
                  {error && <small id={`${path}-error`} className="field-error">{error}</small>}
                  {isLocked && !error && <small>مقفل بعد التسجيل (داخل الشهادة)</small>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {formError && (
        <div className="alert danger" role="alert">
          <strong>{formError}</strong>
        </div>
      )}
      {saved && (
        <div className="alert success" role="status">
          <strong>{loaded.complete ? 'تم الحفظ، والإعدادات مكتملة' : 'تم الحفظ'}</strong>
        </div>
      )}
      <div className="submit-row">
        <span className="hint">{Object.keys(errors).length ? `${Object.keys(errors).length} حقول تحتاج تصحيحاً` : ''}</span>
        <button className="btn primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button>
      </div>
    </form>
  );
}
