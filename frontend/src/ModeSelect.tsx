import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { MODE_COLORS, MODE_DESCRIPTIONS, MODE_STATE_LABELS, MODE_STATE_TONES } from './format';
import type { Mode, ModeInfo } from './types';

interface Props {
  /** يُستدعى بعد حفظ الوضع في الخادم */
  onSelected: (mode: Mode) => void;
}

/** شاشة "اختر وضع التشغيل": ثلاث بطاقات بحالة كل وضع وعدد فواتيره */
export function ModeSelect({ onSelected }: Props) {
  const [modes, setModes] = useState<ModeInfo[] | null>(null);
  const [active, setActive] = useState<Mode | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.modes();
      setModes(res.modes);
      setActive(res.active);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر تحميل الأوضاع');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const choose = async (mode: Mode) => {
    setBusy(mode);
    setError(null);
    try {
      await api.setMode(mode);
      onSelected(mode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mode-select">
      <div className="mode-select-head">
        <h2>اختر وضع التشغيل</h2>
        <p className="hint">لكل وضع إعدادات منشأة وشهادة وسلسلة فواتير مستقلة. يمكنك التبديل بينها لاحقاً.</p>
      </div>

      {error && (
        <div className="alert danger" role="alert">
          <strong>{error}</strong>
          <button className="btn ghost small" onClick={load}>إعادة المحاولة</button>
        </div>
      )}

      {!modes && !error && <p className="hint">جارٍ التحميل…</p>}

      {modes && (
        <div className="mode-cards">
          {modes.map((m) => (
            <article key={m.env} className={`card mode-card mode-${MODE_COLORS[m.env]}${m.env === active ? ' active' : ''}`}>
              <div className="card-head">
                <h3>{m.label}</h3>
                <span className={`badge ${MODE_STATE_TONES[m.state]}`}>{MODE_STATE_LABELS[m.state]}</span>
              </div>
              <p className="mode-desc">{MODE_DESCRIPTIONS[m.env]}</p>
              <dl className="mode-stats">
                <div><dt>الفواتير</dt><dd dir="ltr">{m.invoiceCount}</dd></div>
                <div><dt>المعلّقة</dt><dd dir="ltr">{m.pendingCount}</dd></div>
              </dl>
              {m.env === active && <span className="mode-current">الوضع الحالي</span>}
              <button
                type="button"
                className="btn primary mode-choose"
                disabled={busy !== null || m.env === 'core'}
                title={m.env === 'core' ? 'يتطلب تأكيداً بكتابة CORE' : undefined}
                onClick={() => choose(m.env)}
              >
                {busy === m.env ? 'جارٍ التفعيل…' : 'اختيار'}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
