#!/usr/bin/env bash
# يتأكد أن ملفات التوقيع وبناء XML لم تتغير عن الفرع main،
# لأنها تحققت بأداة الهيئة ويُمنع تعديل منطقها.
set -u

FROZEN_PATHS=(src/zatca/crypto src/zatca/xml)

if git diff --exit-code main -- "${FROZEN_PATHS[@]}"; then
  echo "✔ الملفات المجمّدة لم تتغير: ${FROZEN_PATHS[*]}"
else
  echo "✘ تغيّرت ملفات مجمّدة (${FROZEN_PATHS[*]}) مقارنة بالفرع main." >&2
  echo "  هذه الملفات تحققت بأداة الهيئة ويُمنع تعديل منطقها. أعدها بـ: git checkout main -- ${FROZEN_PATHS[*]}" >&2
  exit 1
fi
