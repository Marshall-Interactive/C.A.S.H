// Money maths: what fell in a period, what is expected, what was spent where.
import * as S from './store.js';
import { fromISO, toISO, sum, periodOf } from './util.js';
import { normalise } from './categorise.js';

export function txInPeriod(p) {
  return S.list('transactions')
    .filter(t => { const d = fromISO(t.date); return d >= p.start && d < p.end; })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

// A receipt split across categories counts against each category separately.
export function spendLines(txs) {
  const out = [];
  for (const t of txs) {
    if (t.type !== 'out' || S.isTransfer(t.categoryId)) continue;
    if (t.splits?.length) t.splits.forEach(s => out.push({ categoryId: s.categoryId, amount: +s.amount }));
    else out.push({ categoryId: t.categoryId, amount: +t.amount });
  }
  return out;
}

export function spentByCategory(txs) {
  const m = {};
  for (const l of spendLines(txs)) m[l.categoryId] = (m[l.categoryId] || 0) + l.amount;
  return m;
}

// Transfers between your own accounts are neither money in nor money out.
export const totals = txs => {
  const real = txs.filter(t => !S.isTransfer(t.categoryId));
  return {
    in: sum(real.filter(t => t.type === 'in'), t => t.amount),
    out: sum(real.filter(t => t.type === 'out'), t => t.amount),
    count: real.filter(t => t.type === 'out').length,
  };
};

// Dates a recurring bill or wage lands inside a period.
const STEP_DAYS = { weekly: 7, fortnightly: 14, fourweekly: 28 };
const STEP_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

export function occurrences(item, p) {
  const res = [];
  const freq = item.frequency || 'monthly';
  if (freq === 'monthly') {
    for (let k = 0; k < 2; k++) {
      const y = p.start.getFullYear(), m = p.start.getMonth() + k;
      const last = new Date(y, m + 1, 0).getDate();
      const d = new Date(y, m, Math.min(+item.dueDay || 1, last));
      if (d >= p.start && d < p.end) res.push(d);
    }
    return res;
  }
  const a = item.anchorDate ? fromISO(item.anchorDate) : p.start;
  if (STEP_DAYS[freq]) {
    const step = STEP_DAYS[freq];
    const diff = Math.round((p.start - a) / 864e5);
    let d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + Math.ceil(diff / step) * step);
    while (d < p.end) {
      if (d >= p.start) res.push(d);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
    }
    return res;
  }
  const sm = STEP_MONTHS[freq];
  const monthsDiff = (p.start.getFullYear() - a.getFullYear()) * 12 + (p.start.getMonth() - a.getMonth());
  const n = Math.floor(monthsDiff / sm);
  for (let k = n - 1; k <= n + 2; k++) {
    const y = a.getFullYear(), m = a.getMonth() + k * sm;
    const last = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(a.getDate(), last));
    if (d >= p.start && d < p.end) res.push(d);
  }
  return res;
}

function scheduled(coll, p, doneKey) {
  const rows = [];
  for (const item of S.list(coll)) {
    if (item.active === false) continue;
    for (const d of occurrences(item, p)) {
      const iso = toISO(d);
      rows.push({ item, date: iso, done: !!item[doneKey]?.[iso] });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
export const billsInPeriod = p => scheduled('bills', p, 'paid');
export const incomesInPeriod = p => scheduled('incomes', p, 'received');
// Pay that varies: expect the average of the last three pays actually received.
export function incomeAmount(i) {
  if (!i.varies) return +i.amount || 0;
  const got = Object.values(i.received || {}).map(id => S.byId('transactions', id)).filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  return got.length ? sum(got, t => t.amount) / got.length : +i.amount || 0;
}
export const expectedIn = p => sum(incomesInPeriod(p), r => incomeAmount(r.item));

// Next date a bill falls due on or after today (looks a year ahead).
export function nextDue(item, from = new Date()) {
  for (let k = 0; k < 13; k++) {
    const p = periodOf(toISO(new Date(from.getFullYear(), from.getMonth() + k, 1)).slice(0, 7));
    const d = occurrences(item, p).find(d => d >= new Date(from.getFullYear(), from.getMonth(), from.getDate()));
    if (d) return toISO(d);
  }
  return null;
}

// ---- import helpers: duplicates and matching to known bills/wages ----
const words = s => new Set(normalise(s).split(' ').filter(w => w.length >= 3 && !/^\d+$/.test(w)));
function shareWord(a, b) {
  const wa = words(a);
  for (const w of words(b)) if (wa.has(w)) return true;
  return false;
}

export function findDuplicate(c, pool = S.list('transactions')) {
  const t = fromISO(c.date);
  return pool.find(x => x.type === c.type && Math.abs(x.amount - c.amount) < 0.005 &&
    Math.abs(fromISO(x.date) - t) <= 3 * 864e5 &&
    (x.date === c.date || shareWord(x.desc, c.desc) || x.billId || x.incomeId));
}

function keywordsOf(item) {
  return String(item.keywords || item.name || '').split(',').map(normalise).filter(Boolean);
}
// How far an amount may differ and still match: pay that varies matches on
// its statement name alone; bills with a statement name allow ±50% (energy bills move around).
function tolerance(coll, item) {
  if (coll === 'incomes') return item.varies || item.keywords ? Infinity : 0.25;
  return item.keywords ? 0.5 : 0.25;
}
function matchScheduled(coll, c) {
  const d = ' ' + normalise(c.desc) + ' ';
  return S.list(coll).find(b => b.active !== false &&
    keywordsOf(b).some(k => d.includes(k)) &&
    Math.abs(b.amount - c.amount) <= Math.max(1, b.amount * tolerance(coll, b)));
}
export const matchBill = c => c.type === 'out' ? matchScheduled('bills', c) : null;
export const matchIncome = c => c.type === 'in' ? matchScheduled('incomes', c) : null;

// Tick off the occurrence of a bill/wage nearest to a transaction's date.
export function linkOccurrence(item, doneKey, tx) {
  const key = tx.date.slice(0, 7);
  const cands = [-1, 0, 1].flatMap(k => {
    const [y, m] = key.split('-').map(Number);
    const pk = toISO(new Date(y, m - 1 + k, 1)).slice(0, 7);
    return occurrences(item, periodOf(pk));
  });
  // Only unpaid occurrences, due no more than 5 days after the payment (bills
  // are rarely paid early) and no more than 20 days before it.
  const t = fromISO(tx.date);
  const best = cands
    .filter(d => !item[doneKey]?.[toISO(d)] && d - t <= 5 * 864e5 && t - d <= 20 * 864e5)
    .sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
  if (!best) return;
  const iso = toISO(best);
  item[doneKey] = { ...(item[doneKey] || {}), [iso]: tx.id };
  item.updatedAt = Date.now();
}


