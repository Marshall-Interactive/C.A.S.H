import { getState } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const round2 = n => Math.round((+n || 0) * 100) / 100;
export const sum = (arr, f = x => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);

export function parseAmount(v) {
  let s = String(v ?? '').replace(/[£$€\s,]/g, '');
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ---- money ----
const fmts = {};
function fmt(whole) {
  const { currency = 'AUD', locale = 'en-AU' } = getState()?.settings || {};
  const k = currency + locale + whole;
  return fmts[k] ||= new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
  });
}
export function money(n, { sign = false, whole = false } = {}) {
  const v = fmt(whole).format(Math.abs(n || 0));
  return (n < -0.004 ? '−' : sign && n > 0.004 ? '+' : '') + v;
}
export function moneyShort(n) {
  const a = Math.abs(n);
  if (a >= 1000) return currencySymbol() + (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return currencySymbol() + Math.round(a);
}
export function currencySymbol() {
  return fmt(true).formatToParts(0).find(p => p.type === 'currency')?.value || '$';
}

// ---- dates (stored as local YYYY-MM-DD strings) ----
const pad = n => String(n).padStart(2, '0');
export const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayISO = () => toISO(new Date());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) =>
  fromISO(iso).toLocaleDateString('en-AU', opts);

export function relDay(iso) {
  const t = todayISO();
  if (iso === t) return 'Today';
  if (iso === toISO(addDays(new Date(), -1))) return 'Yesterday';
  return fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
}

// A "period" is a budget month. If the family is paid on the 28th they can
// set monthStartDay = 28 so each month runs payday to payday.
const startDay = () => getState()?.settings.monthStartDay || 1;

// Or a pay fortnight: payday to the day before the next payday. Fortnight keys
// are the payday ("2026-10-29"); month keys stay "2026-10", so either kind of
// key can be read back whichever view is on.
let kind = null;
export function payAnchor() {
  const st = getState();
  if (st?.settings.payAnchor) return st.settings.payAnchor;
  const pays = (st?.incomes || []).filter(i => !i.deleted && i.active !== false && i.frequency === 'fortnightly' && i.anchorDate)
    .sort((a, b) => (+b.amount || 0) - (+a.amount || 0));
  return pays[0]?.anchorDate || null;
}
export function periodKind() {
  if (kind == null) { try { kind = localStorage.getItem('cash.periodKind') || 'month'; } catch { kind = 'month'; } }
  return kind === 'fortnight' && payAnchor() ? 'fortnight' : 'month';
}
export function setPeriodKind(k) { kind = k; try { localStorage.setItem('cash.periodKind', k); } catch {} }
const isFortnight = key => key.length === 10;
const dayDiff = (a, b) => Math.round((b - a) / 864e5);
export function fortnightKey(date = new Date()) {
  const a = fromISO(payAnchor());
  return toISO(addDays(a, Math.floor(dayDiff(a, new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 14) * 14));
}
// Budgets are set per month; a fortnight gets 12/26 of each.
export const budgetScale = p => (p.kind === 'fortnight' ? 12 / 26 : 1);
export const periodWord = p => (p.kind === 'fortnight' ? 'pay' : 'month');

export function currentPeriodKey(date = new Date()) {
  return periodKind() === 'fortnight' ? fortnightKey(date) : currentMonthKey(date);
}
export function currentMonthKey(date = new Date()) {
  let y = date.getFullYear(), m = date.getMonth();
  if (date.getDate() < startDay()) m -= 1;
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftPeriod(key, n) {
  if (isFortnight(key)) return toISO(addDays(fromISO(key), 14 * n));
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function periodOf(key) {
  if (isFortnight(key)) {
    const start = fromISO(key), end = addDays(start, 14);
    const dm = d => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const range = `${dm(start)} – ${dm(addDays(end, -1))}`;
    return { key, start, end, label: range, short: dm(start), range, kind: 'fortnight', month: currentMonthKey(start) };
  }
  const [y, m] = key.split('-').map(Number);
  const sd = startDay();
  const start = new Date(y, m - 1, sd);
  const end = new Date(y, m, sd);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const short = new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
  const range = sd === 1 ? monthName
    : `${fmtDate(toISO(start))} – ${fmtDate(toISO(addDays(end, -1)))}`;
  return { key, start, end, label: monthName, short, range, kind: 'month', month: key };
}

export const inPeriod = (iso, p) => { const d = fromISO(iso); return d >= p.start && d < p.end; };

export const FREQS = {
  weekly: 'Weekly', fortnightly: 'Fortnightly', fourweekly: 'Every 4 weeks',
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
};
const PER_MONTH = { weekly: 52 / 12, fortnightly: 26 / 12, fourweekly: 13 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
export const perMonth = (amount, freq) => (+amount || 0) * (PER_MONTH[freq] ?? 1);

// Loose date reader used by the receipt, screenshot and CSV importers.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function mk(y, m, d) {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? toISO(dt) : null;
}
function guessYear(m, d) {
  const now = new Date();
  const y = now.getFullYear();
  return new Date(y, m - 1, d) > addDays(now, 7) ? y - 1 : y;
}
export function parseDate(str, { dayFirst = true } = {}) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (/^today\b/.test(s)) return todayISO();
  if (/^yesterday\b/.test(s)) return toISO(addDays(new Date(), -1));
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return mk(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    return (!dayFirst || b > 12) && a <= 12 ? mk(y, a, b) : mk(y, b, a);
  }
  m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([a-z]{3})[a-z]*\.?(?:[\s\-,]+(\d{4}|\d{2})\b)?/);
  if (m && MONTHS.includes(m[2])) {
    const mo = MONTHS.indexOf(m[2]) + 1, d = +m[1];
    let y = m[3] ? +m[3] : guessYear(mo, d);
    if (y < 100) y += 2000;
    return mk(y, mo, d);
  }
  m = s.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s*(\d{4})?/);
  if (m && MONTHS.includes(m[1])) {
    const mo = MONTHS.indexOf(m[1]) + 1, d = +m[2];
    return mk(m[3] ? +m[3] : guessYear(mo, d), mo, d);
  }
  return null;
}

export function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\s+/g, ' ').trim();
}

const loaded = {};
export function loadScript(src) {
  return loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src + ' — are you online?')); };
    document.head.appendChild(s);
  });
}

export function download(filename, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
