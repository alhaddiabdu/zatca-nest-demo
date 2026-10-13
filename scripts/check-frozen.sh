#!/usr/bin/env bash
# يتأكد أن ملفات التوقيع وبناء XML لم تتغير عن النسخة الأصلية (أول commit)،
# لأنها تحققت بأداة الهيئة ويُمنع تعديل منطقها.
# المقارنة مع commit ثابت وليس مع فرع، لأن العمل كله على main.
#
# التعديلات المسموحة فقط مسجّلة حرفياً في scripts/frozen-allowed.patch:
# يُستخرج الأصل، ويُطبَّق عليه الـ patch، ثم يجب أن يطابق الناتج الملفات الحالية تماماً.
# أي تعديل خارج الـ patch (أو ملف جديد أو محذوف) يُرفض. كل استثناء يُذكر في رسالة commit.
#
# الاستثناءات الحالية:
# - invoice-builder.ts: سطر وقت QR (UTC ينتهي بـ Z)
set -u

BASELINE=ea4af78
FROZEN_PATHS=(src/zatca/crypto src/zatca/xml)
ROOT=$(git rev-parse --show-toplevel)
ALLOWED_PATCH="$ROOT/scripts/frozen-allowed.patch"

fail() {
  echo "✘ تغيّرت ملفات مجمّدة (${FROZEN_PATHS[*]}) خارج الاستثناءات المسموحة في scripts/frozen-allowed.patch." >&2
  echo "  هذه الملفات تحققت بأداة الهيئة ويُمنع تعديل منطقها." >&2
  exit 1
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# الأصل كما هو في BASELINE
git -C "$ROOT" archive "$BASELINE" -- "${FROZEN_PATHS[@]}" | tar -x -C "$work" || fail

# تطبيق الاستثناءات المسموحة (يفشل إن لم تنطبق حرفياً)
if [ -s "$ALLOWED_PATCH" ]; then
  (cd "$work" && patch -s -p1 --forward --no-backup-if-mismatch -r - < "$ALLOWED_PATCH") || fail
fi

# الناتج يجب أن يطابق الملفات الحالية تماماً
for p in "${FROZEN_PATHS[@]}"; do
  diff -ru "$work/$p" "$ROOT/$p" || fail
done

echo "✔ الملفات المجمّدة مطابقة للأصل مع الاستثناءات المسموحة فقط: ${FROZEN_PATHS[*]}"
