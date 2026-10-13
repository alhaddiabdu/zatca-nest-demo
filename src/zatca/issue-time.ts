/**
 * تاريخ ووقت الإصدار بتوقيت UTC: IssueDate = YYYY-MM-DD و IssueTime = HH:mm:ssZ.
 * وقت QR (الوسم 3) يُبنى منهما حرفياً: IssueDate + "T" + IssueTime، فينتهي بـ Z.
 * بدون Z (وقت محلي) ترفض الهيئة الفواتير المبسطة لعدم تطابق وقت QR مع وقت الإصدار.
 * العرض للمستخدم بتوقيت الرياض يتم في الواجهة.
 */
export function utcIssueDateTime(d = new Date()): { date: string; time: string } {
  const iso = d.toISOString(); // 2026-10-13T09:15:30.123Z
  return { date: iso.slice(0, 10), time: `${iso.slice(11, 19)}Z` };
}
