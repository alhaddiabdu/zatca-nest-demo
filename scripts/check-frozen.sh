#!/usr/bin/env bash
# يتأكد أن ملفات التوقيع وبناء XML لم تتغير عن النسخة الأصلية (أول commit)،
# لأنها تحققت بأداة الهيئة ويُمنع تعديل منطقها.
# المقارنة مع commit ثابت وليس مع فرع، لأن العمل كله على main.
#
# استثناء واحد مسموح: سطر وقت QR (الوسم 3) في invoice-builder.ts، صار يوثّق أن
# IssueTime بتوقيت UTC وينتهي بـ Z (انظر src/zatca/issue-time.ts). الملف يُقارن
# بالأصل بعد تطبيق هذا الاستبدال عليه، فأي تغيير آخر فيه يُرفض.
set -u

BASELINE=ea4af78
FROZEN_PATHS=(src/zatca/crypto src/zatca/xml)
BUILDER=src/zatca/xml/invoice-builder.ts
ALLOWED_OLD='      timestamp: `${input.issueDate}T${input.issueTime}`, // نفس IssueTime حرفياً (توقيت الرياض بدون Z)'
ALLOWED_NEW='      timestamp: `${input.issueDate}T${input.issueTime}`, // IssueDate + "T" + IssueTime حرفياً: UTC ينتهي بـ Z (issue-time.ts)'

fail() {
  echo "✘ تغيّرت ملفات مجمّدة (${FROZEN_PATHS[*]}) مقارنة بالنسخة الأصلية $BASELINE." >&2
  echo "  هذه الملفات تحققت بأداة الهيئة ويُمنع تعديل منطقها. أعدها بـ: git checkout $BASELINE -- ${FROZEN_PATHS[*]}" >&2
  echo "  (المسموح فقط: سطر وقت QR في $BUILDER)" >&2
  exit 1
}

# كل الملفات المجمّدة عدا invoice-builder.ts: مطابقة تامة
git diff --exit-code "$BASELINE" -- "${FROZEN_PATHS[@]}" ":(exclude)$BUILDER" || fail

# invoice-builder.ts: الأصل مع استبدال السطر المسموح فقط
expected_file=$(mktemp)
trap 'rm -f "$expected_file"' EXIT
git show "$BASELINE:$BUILDER" | ALLOWED_OLD="$ALLOWED_OLD" ALLOWED_NEW="$ALLOWED_NEW" node -e '
  let s = require("fs").readFileSync(0, "utf8");
  const { ALLOWED_OLD: o, ALLOWED_NEW: n } = process.env;
  if (s.split(o).length !== 2) { console.error("السطر المسموح غير موجود مرة واحدة في الأصل"); process.exit(1); }
  process.stdout.write(s.replace(o, () => n));
' >"$expected_file" || fail
diff -u "$expected_file" "$BUILDER" || fail

echo "✔ الملفات المجمّدة لم تتغير: ${FROZEN_PATHS[*]} (عدا سطر وقت QR المسموح في $BUILDER)"
