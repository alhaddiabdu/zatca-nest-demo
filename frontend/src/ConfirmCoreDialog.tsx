import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** الكلمة التي يجب كتابتها حرفياً (مطابقة للخادم) */
export const CORE_CONFIRMATION = 'CORE';

interface Props {
  open: boolean;
  onCancel: () => void;
  /** يُستدعى بعد قبول الخادم للتفعيل */
  onConfirmed: () => void;
}

/** نافذة تأكيد قبل تفعيل الإنتاج: يكتب المستخدم CORE حرفياً */
export function ConfirmCoreDialog({ open, onCancel, onConfirmed }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = text === CORE_CONFIRMATION;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setText('');
      setError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      await api.setMode('core', text);
      onConfirmed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-core-title"
      // Esc يطلق cancel: نتركه للأب ليغلق النافذة
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={submit} className="form">
        <h2 id="confirm-core-title">تفعيل وضع الإنتاج</h2>
        <div className="alert danger">
          <strong>كل فاتورة تُصدر في هذا الوضع رسمية وتُرسل لهيئة الزكاة والضريبة والجمارك.</strong>
          <span>يلزم أن تكون بيانات المنشأة حقيقية، وأن يكون لديك OTP من بوابة فاتورة الرسمية.</span>
        </div>
        <label className="field">
          <span>
            للتأكيد اكتب <code dir="ltr">{CORE_CONFIRMATION}</code>
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="ltr"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            aria-invalid={text.length > 0 && !matches}
          />
        </label>
        {error && (
          <div className="alert danger" role="alert">
            <strong>{error}</strong>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button type="submit" className="btn danger" disabled={!matches || busy}>
            {busy ? 'جارٍ التفعيل…' : 'تفعيل الإنتاج'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
