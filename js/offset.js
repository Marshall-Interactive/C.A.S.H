// The offset as savings: its balance over time, milestones passed, interest
// it has saved, and pots that carve the balance up into goals.
// Linked pots fill in order ("Emergency fund first, then Holiday…"), each up
// to its goal; whatever is left is free.
import * as S from './store.js';
import { sum, fromISO, toISO, addDays } from './util.js';

export const SAVINGS_KINDS = new Set(['offset', 'savings']);
export const savingsAccounts = () => S.list('accounts').filter(a => SAVINGS_KINDS.has(a.kind));

export const MILESTONES = [1000, 2500, 5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 75000, 100000,
  125000, 150000, 175000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000];
export const nextMilestone = v => MILESTONES.find(m => m > v);

// Pots that live inside an account, in the order they fill.
export function linkedPots(accId) {
  return S.list('pots').filter(p => p.linkTo === accId)
    .sort((a, b) => (a.fillOrder ?? 0) - (b.fillOrder ?? 0) || a.name.localeCompare(b.name));
}

export function allocation(accId, balance) {
  const acc = S.byId('accounts', accId);
  let left = Math.max(0, balance ?? acc?.balance ?? 0);
  const map = {};
  for (const p of linkedPots(accId)) {
    const give = Math.min(+p.goal || 0, left);
    map[p.id] = give;
    left -= give;
  }
  return { map, free: left, balance: Math.max(0, balance ?? acc?.balance ?? 0) };
}

// Balance history as points, one per day (the last recorded that day).
export function series(acc) {
  const byDay = {};
  for (const h of acc.history || []) if (h.balance != null) byDay[h.date] = h.balance;
  return Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, v }));
}

// Milestones the balance climbed past, and when.
export function crossings(points) {
  const out = [];
  let max = points[0]?.v ?? 0;
  for (const p of points.slice(1)) {
    for (const m of MILESTONES) if (max < m && p.v >= m) out.push({ m, date: p.date });
    max = Math.max(max, p.v);
  }
  return out;
}

// Interest the offset has saved on the home loan since a date: each day's
// balance × rate ÷ 365, using the balance in force on that day.
export function interestSaved(acc, since) {
  if (!acc.rate) return null;
  const pts = series(acc);
  if (!pts.length) return null;
  const today = new Date(new Date().toDateString());
  let total = 0, d = fromISO(pts[0].date) > since ? fromISO(pts[0].date) : since;
  let i = 0, bal = pts[0].v;
  while (i + 1 < pts.length && fromISO(pts[i + 1].date) <= d) bal = pts[++i].v;
  for (; d < today; d = addDays(d, 1)) {
    while (i + 1 < pts.length && pts[i + 1].date <= toISO(d)) bal = pts[++i].v;
    total += Math.max(0, bal) * acc.rate / 100 / 365;
  }
  return total;
}

// The balance at the end of a given day (the latest point on or before it).
export function balanceOn(acc, iso) {
  const pts = series(acc).filter(p => p.date <= iso);
  return pts.length ? pts[pts.length - 1].v : null;
}

// Before/after snapshot so an update can be celebrated.
export function snapshot(accId) {
  const acc = S.byId('accounts', accId);
  if (!acc || !SAVINGS_KINDS.has(acc.kind)) return null;
  const max = Math.max(0, ...series(acc).map(p => p.v));
  const a = allocation(accId);
  return { accId, max, balance: acc.balance ?? 0, fills: { ...a.map } };
}
export const linkedTotal = () => sum(savingsAccounts(), a => Math.max(0, a.balance || 0));
