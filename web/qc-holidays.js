// Québec statutory holidays — computed, not tabulated, so there is no list to
// expire. Every rule below is a formula, so `qcHolidays(year)` answers for any
// year rather than for a fixed window.
//
// WHAT COUNTS. These are the jours fériés, chômés et payés that apply to a
// Québec-regulated worker: the seven in the Loi sur les normes du travail (s.
// 60) plus the Fête nationale, which has its own statute (Loi sur la fête
// nationale). A federal holiday only appears here if it also applies in Québec.
//
// DELIBERATELY EXCLUDED, each for a reason — do not "fix" these back in:
//   · Family Day            — Ontario/BC/Alberta etc. Québec has no such day.
//   · Civic Holiday (Aug)   — Ontario etc. Not a Québec holiday.
//   · Boxing Day (Dec 26)   — Ontario. Not a Québec statutory holiday.
//   · Remembrance Day       — federal + some provinces; NOT Québec.
//   · Truth & Reconciliation (Sep 30) — federal statutory holiday, binding on
//     federally regulated employers only. Québec has not adopted it, so it does
//     not apply to a Québec-regulated worker.
//   · Victoria Day          — the same Monday IS a holiday here, but in Québec
//     it is the Journée nationale des patriotes, which is the entry below.
//
// ONE JUDGEMENT CALL: the Easter holiday is Good Friday **or** Easter Monday —
// the statute lets the EMPLOYER pick, so no calendar can be right for everyone.
// Good Friday is marked, being the more commonly observed of the two; swap
// `_goodFriday` for `_easterMonday` below if the other is wanted.
(function () {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Anonymous Gregorian computus. Returns Easter Sunday in local time.
  function _easterSunday(y) {
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const n = h + l - 7 * m + 114;
    return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
  }

  const _shift = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  const _goodFriday = (y) => _shift(_easterSunday(y), -2);

  // nth (1-based) `dow` of a month, e.g. the 2nd Monday of October.
  function _nthDow(y, month, dow, nth) {
    const first = new Date(y, month, 1);
    const offset = (dow - first.getDay() + 7) % 7;
    return new Date(y, month, 1 + offset + (nth - 1) * 7);
  }

  // "le lundi qui précède le 25 mai" — strictly before, so a May 25 that IS a
  // Monday pushes back a full week to May 18 (same rule as Victoria Day).
  function _patriotes(y) {
    const may25 = new Date(y, 4, 25);
    const dow = may25.getDay();
    return _shift(may25, -(dow === 1 ? 7 : (dow + 6) % 7));
  }

  // July 1, or July 2 when the 1st is a Sunday (LNT s. 60, para. 5).
  function _canadaDay(y) {
    const jul1 = new Date(y, 6, 1);
    return jul1.getDay() === 0 ? _shift(jul1, 1) : jul1;
  }

  const _cache = {};

  // ISO dates of every Québec statutory holiday in `year`.
  function qcHolidays(year) {
    if (!_cache[year]) {
      _cache[year] = new Set([
        new Date(year, 0, 1),        // Jour de l'An
        _goodFriday(year),           // Vendredi saint (or Easter Monday — see header)
        _patriotes(year),            // Journée nationale des patriotes
        new Date(year, 5, 24),       // Fête nationale du Québec
        _canadaDay(year),            // Fête du Canada
        _nthDow(year, 8, 1, 1),      // Fête du Travail — 1st Monday of September
        _nthDow(year, 9, 1, 2),      // Action de grâce — 2nd Monday of October
        new Date(year, 11, 25),      // Noël
      ].map(iso));
    }
    return _cache[year];
  }

  // `d` is a local Date. Cheap enough to call per calendar cell (per-year cache).
  function isQcHoliday(d) {
    return qcHolidays(d.getFullYear()).has(iso(d));
  }

  window.QcHolidays = { qcHolidays, isQcHoliday };
})();
