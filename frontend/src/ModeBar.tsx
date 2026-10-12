import { ENV_LABELS, MODE_COLORS } from './format';
import type { Mode } from './types';

interface Props {
  mode: Mode | null;
  /** بدون هذه الدالة يظهر الزر معطّلاً */
  onChangeMode?: () => void;
}

/** اسم الوضع الحالي بلونه + زر تغيير الوضع، يوضع داخل الشريط العلوي */
export function ModeBar({ mode, onChangeMode }: Props) {
  if (!mode) return null;
  return (
    <div className="modebar">
      <span className={`mode-pill mode-${MODE_COLORS[mode]}`}>
        <span className="mode-dot" aria-hidden />
        {ENV_LABELS[mode]}
      </span>
      <button
        type="button"
        className="btn ghost small"
        onClick={onChangeMode}
        disabled={!onChangeMode}
        title={onChangeMode ? undefined : 'متاح قريباً'}
      >
        تغيير الوضع
      </button>
    </div>
  );
}

/** شريط تحذير دائم في وضع الإنتاج، لا يُغلق */
export function CoreBanner({ mode }: { mode: Mode | null }) {
  if (mode !== 'core') return null;
  return (
    <div className="core-banner" role="alert">
      <strong>وضع الإنتاج</strong>
      <span>كل فاتورة تُصدر هنا رسمية وتُرسل لهيئة الزكاة والضريبة والجمارك.</span>
    </div>
  );
}
