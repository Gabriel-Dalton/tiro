// Usage and savings, computed from local history. A live Deepgram balance is
// not available to a browser (the balances endpoint is REST → CORS-blocked,
// docs/RESEARCH.md #7), so everything here is a local estimate and the UI must
// label it as one.

import { STREAMING_PER_MIN, COMPETITORS } from "./tokens.js";

export { STREAMING_PER_MIN, COMPETITORS };

/** entries -> stats for the month containing `now` (local time). */
export function monthStats(entries, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const dailyMinutes = new Array(daysInMonth).fill(0);
  let totalSec = 0;
  let count = 0;
  for (const e of entries) {
    const d = new Date(e.ts);
    if (d.getFullYear() === y && d.getMonth() === m) {
      totalSec += e.sec || 0;
      count++;
      dailyMinutes[d.getDate() - 1] += (e.sec || 0) / 60;
    }
  }
  const minutes = totalSec / 60;
  const cost = minutes * STREAMING_PER_MIN;
  const cheapest = Math.min(...COMPETITORS.map((c) => c.perMonth));
  return {
    minutes,
    cost,
    count,
    dailyMinutes,
    today: now.getDate(),
    savedVsCheapest: Math.max(0, cheapest - cost),
    // hours of dictation at which streaming nova-3 costs as much as the
    // cheapest subscription — the argument for the whole project
    breakEvenHours: cheapest / STREAMING_PER_MIN / 60,
  };
}

export function fmtMoney(v) {
  return `$${v.toFixed(2)}`;
}

export function fmtMinutes(min) {
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min.toFixed(1)} min`;
  return `${(min / 60).toFixed(1)} h`;
}
