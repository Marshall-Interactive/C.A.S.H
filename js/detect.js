// Spotting regular money in your payments: the same payer/payee turning up on
// a steady rhythm (weekly, fortnightly, monthly…) is probably a wage or a bill.
import * as S from './store.js';
import { fromISO, toISO, round2, todayISO } from './util.js';
import { normalise } from './categorise.js';
import { matchBill, matchIncome, occurrences } from './calc.js';

const keyOf = d => normalise(d).split(' ').filter(w => w.length > 1 && !/\d/.test(w)).slice(0, 3).join(' ');

// [frequency, typical gap in days, allowed wobble in days]
const RHYTHMS = [['weekly', 7, 1], ['fortnightly', 14, 2], ['fourweekly', 28, 2], ['monthly', 30.4, 4], ['quarterly', 91, 10], ['yearly', 365, 20]];
// Spending categories that can be "bills"; regular shopping isn't a bill.
const BILL_CATS = new Set(['housing', 'counciltax', 'energy', 'water', 'broadband', 'insurance', 'healthins', 'car', 'childcare', 'debt', 'subscriptions', 'health', 'kids', 'pets']);

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// onlyFor: limit to payees that appear in these transactions (e.g. a fresh import).
export function findRegular(onlyFor = null) {
  const wanted = onlyFor && new Set(onlyFor.map(t => t.type + '|' + keyOf(t.desc)));
  const groups = {};
  for (const t of S.list('transactions')) {
    if (S.isTransfer(t.categoryId) || t.billId || t.incomeId || t.source === 'pot') continue;
    const k = t.type + '|' + keyOf(t.desc);
    if (!keyOf(t.desc) || (wanted && !wanted.has(k))) continue;
    (groups[k] ||= []).push(t);
  }
  const found = [];
  for (const [k, list] of Object.entries(groups)) {
    const byDate = [...new Map(list.sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t])).values()];
    if (byDate.length < 2) continue;
    const gaps = byDate.slice(1).map((t, i) => Math.round((fromISO(t.date) - fromISO(byDate[i].date)) / 864e5));
    const rhythm = RHYTHMS.find(([, d, tol]) => Math.abs(median(gaps) - d) <= tol);
    if (!rhythm || !gaps.every(g => Math.abs(g - rhythm[1]) <= rhythm[2] * 1.5)) continue;
    const [type] = k.split('|');
    const last = byDate[byDate.length - 1];
    const recent = byDate.slice(-3).map(t => t.amount);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const spread = (Math.max(...recent) - Math.min(...recent)) / avg;
    if (type === 'out' && !BILL_CATS.has(last.categoryId) && spread > 0.25) continue;
    // already set up as a wage/bill?
    const probe = { desc: last.desc, amount: last.amount, type };
    if (type === 'in' ? matchIncome(probe) : matchBill(probe)) continue;
    found.push({
      type, keywords: k.slice(type.length + 1), name: last.desc.replace(/\s+/g, ' ').trim().slice(0, 40),
      frequency: rhythm[0], amount: round2(type === 'in' ? avg : last.amount), varies: spread > 0.02,
      dueDay: fromISO(last.date).getDate(), anchorDate: last.date, categoryId: last.categoryId,
      member: last.member, txIds: byDate.map(t => t.id), count: byDate.length,
    });
  }
  return found.sort((a, b) => (a.type === 'in' ? 0 : 1) - (b.type === 'in' ? 0 : 1) || b.amount - a.amount);
}

// The next date a suggestion is expected, for showing "next pay 12 Nov".
export function nextDate(s) {
  const today = todayISO();
  for (let k = 0; k < 14; k++) {
    const d = new Date(); const y = d.getFullYear(), m = d.getMonth() + k;
    const p = { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    const hit = occurrences(s, p).map(toISO).find(iso => iso > today);
    if (hit) return hit;
  }
  return null;
}
