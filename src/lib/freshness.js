/**
 * Freshness utility to check if data asOf date is more than 1 business day behind IST today.
 */
export function isDataStale(asOfStr) {
  if (!asOfStr || typeof asOfStr !== "string") return false;

  // Current time in IST (UTC+5:30)
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const istMs = utcMs + (5 * 60 + 30) * 60 * 1000;
  const istNow = new Date(istMs);

  const parts = asOfStr.trim().split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;

  const asOfDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const todayDate = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());

  if (asOfDate >= todayDate) return false;

  // Count business days strictly between asOfDate and todayDate
  let businessDaysBehind = 0;
  const cur = new Date(asOfDate);
  cur.setDate(cur.getDate() + 1);

  while (cur <= todayDate) {
    const day = cur.getDay(); // 0 is Sunday, 6 is Saturday
    if (day !== 0 && day !== 6) {
      businessDaysBehind++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  return businessDaysBehind > 1;
}

