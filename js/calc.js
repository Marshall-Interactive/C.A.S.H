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
    if (t.splits?.length) t.splits.forEach(s => out.push({ categoryId: s.categoryId, amount: +s.amount, tx: t }));
    else out.push({ categoryId: t.categoryId, amount: +t.amount, tx: t });
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

const FROM_BANK = new Set(['csv', 'pdf']);

// Is this bank row something already in C.A.S.H?
// 1. Your own entries win: anything you added yourself (by hand, receipt,
//    ticking a bill…) with the same amount within 3 days is a match, whatever
//    it's called. The closest date wins; each entry can only match one row.
// 2. Otherwise it's a repeat of an earlier import if the date or a word in
//    the name also lines up (or it was linked to your entry last time).
// `used` stops one entry soaking up two identical rows (two $4.50 coffees).
export function findDuplicate(c, pool = S.list('transactions'), used = new Set()) {
  const t = fromISO(c.date);
  // rows from two different accounts (or the offset vs its home loan) are never the same payment
  const otherAccount = x => c.accountId && x.accountId && (x.accountId !== c.accountId || (x.accountPart || '') !== (c.accountPart || ''));
  const near = x => !used.has(x.id) && !otherAccount(x) && x.type === c.type && Math.abs(x.amount - c.amount) < 0.005 &&
    Math.abs(fromISO(x.date) - t) <= 3 * 864e5;
  const gap = x => Math.abs(fromISO(x.date) - t);
  const mine = pool.filter(x => near(x) && !FROM_BANK.has(x.source) && !x.bankMatched).sort((a, b) => gap(a) - gap(b))[0];
  if (mine) return mine;
  return pool.find(x => near(x) && (x.date === c.date || shareWord(x.desc, c.desc) || x.billId || x.incomeId ||
    (x.bankMatched && (x.bankDate === c.date || shareWord(x.bankDesc || '', c.desc)))));
}
export const isMine = x => !FROM_BANK.has(x.source);

function keywordsOf(item) {
  return String(item.keywords || item.name || '').split(',').map(normalise).filter(Boolean);
}
// How far an amount may differ and still match: pay that varies matches on
// its statement name alone; bills with a statement name allow ±50% (energy bills move around).
function tolerance(coll, item) {
  if (coll === 'incomes') return item.varies || item.keywords ? Infinity : 0.25;
  return item.keywords ? 0.5 : 0.25;
}
// Statement names get cut short ("INLEX ENGINEERIN") or gain extra bits
// ("… JAMES MARSHALL 0123"), so words match if one starts with the other.
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
export function nameMatches(keyword, desc) {
  const d = ' ' + normalise(desc) + ' ';
  if (d.includes(' ' + keyword + ' ') || d.includes(keyword)) return true;
  const kw = [...words(keyword)], dw = [...words(desc)];
  if (!kw.length) return false;
  const hits = kw.filter(k => dw.some(w => sameWord(k, w))).length;
  return hits >= Math.min(2, kw.length) && hits >= kw.length * 0.6;
}
function matchScheduled(coll, c) {
  return S.list(coll).find(b => b.active !== false &&
    keywordsOf(b).some(k => nameMatches(k, c.desc)) &&
    Math.abs(b.amount - c.amount) <= Math.max(1, b.amount * tolerance(coll, b)));
}
export const matchBill = c => c.type === 'out' ? matchScheduled('bills', c) : null;
// Pay with no statement name yet: the one wage due around then, roughly the
// right amount (closer still if the row has the person's name in it).
export function matchIncome(c) {
  if (c.type !== 'in') return null;
  const named = matchScheduled('incomes', c);
  if (named) return named;
  const d = normalise(c.desc), t = fromISO(c.date);
  const due = i => [-1, 0, 1].some(k => occurrences(i, periodOf(toISO(new Date(t.getFullYear(), t.getMonth() + k, 1)).slice(0, 7)))
    .some(o => Math.abs(o - t) <= 4 * 864e5));
  const cands = S.list('incomes').filter(i => i.active !== false && !i.keywords && due(i) && (() => {
    const near = Math.abs(i.amount - c.amount) / (i.amount || 1);
    const hasName = i.member && d.split(' ').includes(normalise(i.member));
    return near <= (hasName ? 0.5 : 0.3);
  })());
  return cands.length === 1 ? cands[0] : null;
}

// Tick off the occurrence of a bill/wage nearest to a transaction's date.
export function linkOccurrence(item, doneKey, tx) {
  const key = tx.date.slice(0, 7);
  const cands = [-1, 0, 1].flatMap(k => {
    const [y, m] = key.split('-').map(Number);
    const pk = toISO(new Date(y, m - 1 + k, 1)).slice(0, 7);
    return occurrences(item, periodOf(pk));
  });
  // Only unpaid occurrences, due no more than 5 days after the payment (bills
  // are rarely paid early) and no more than 20 days before it. One you ticked
  // by hand (at the estimate) counts as unpaid: the real bank payment replaces it.
  const t = fromISO(tx.date);
  const tick = d => { const x = S.byId('transactions', item[doneKey]?.[toISO(d)]); return x && x.id !== tx.id && (x.source === 'bill' || x.source === 'income') ? x : null; };
  const open = d => !item[doneKey]?.[toISO(d)] || !S.byId('transactions', item[doneKey][toISO(d)]) || tick(d);
  const best = cands
    .filter(d => open(d) && d - t <= 5 * 864e5 && t - d <= 20 * 864e5)
    .sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
  if (!best) return;
  const old = tick(best);
  if (old) S.remove('transactions', old.id, { silent: true });
  const iso = toISO(best);
  item[doneKey] = { ...(item[doneKey] || {}), [iso]: tx.id };
  item.updatedAt = Date.now();
}

// The payment that ticked off a bill/wage on a given date (if it still exists).
export const doneTx = (item, doneKey, iso) => S.byId('transactions', item[doneKey]?.[iso]);

// After an import (or a wage is saved): find pays that weren't linked yet,
// tick off their paydays and remember the name they come in under.
export function relinkIncomes() {
  const since = Date.now() - 120 * 864e5;
  const linked = new Set(S.list('incomes').flatMap(i => Object.values(i.received || {})));
  const txs = S.list('transactions').filter(t => t.type === 'in' && !S.isTransfer(t.categoryId) && FROM_BANK.has(t.source) &&
    !linked.has(t.id) && fromISO(t.date) >= since).sort((a, b) => a.date.localeCompare(b.date));
  let n = 0;
  for (const t of txs) {
    const item = (t.incomeId && S.byId('incomes', t.incomeId)) || matchIncome(t);
    if (!item) continue;
    learnPayName(item, t);
    t.incomeId = item.id;
    if (t.categoryId === 'otherin') t.categoryId = 'wages';
    t.updatedAt = Date.now();
    linkOccurrence(item, 'received', t);
    n++;
  }
  return n;
}

// First real pay seen for a wage: keep its statement name so later pays match
// on name alone, and expect the average of real pays from now on.
export function learnPayName(item, t) {
  let changed = false;
  if (!item.keywords) {
    const name = normalise(t.desc).split(' ').filter(w => w.length >= 3 && !/\d/.test(w)).slice(0, 4).join(' ');
    if (name) { item.keywords = name; changed = true; }
  }
  if (!item.varies && Math.abs(item.amount - t.amount) >= 1) { item.varies = true; changed = true; }
  if (changed) item.updatedAt = Date.now();
}


