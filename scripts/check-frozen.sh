#!/usr/bin/env bash
# يتأكد أن ملفات التوقيع وبناء XML لم تتغير عن النسخة الأصلية (أول commit)،
# لأنها تحققت بأداة الهيئة ويُمنع تعديل منطقها.
# المقارنة مع commit ثابت وليس مع فرع، لأن العمل كله على main.
set -u

BASELINE=ea4af78
FROZEN_PATHS=(src/zatca/crypto src/zatca/xml)

if git diff --exit-code "$BASELINE" -- "${FROZEN_PATHS[@]}"; then
  echo "✔ الملفات المجمّدة لم تتغير: ${FROZEN_PATHS[*]}"
else
  echo "✘ تغيّرت ملفات مجمّدة (${FROZEN_PATHS[*]}) مقارنة بالنسخة الأصلية $BASELINE." >&2
  echo "  هذه الملفات تحققت بأداة الهيئة ويُمنع تعديل منطقها. أعدها بـ: git checkout $BASELINE -- ${FROZEN_PATHS[*]}" >&2
  exit 1
fi
