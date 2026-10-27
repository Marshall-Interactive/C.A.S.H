// An account's statement: every payment C.A.S.H has for that account in a
// month, day by day, with the balance worked out from the nearest balance you
// recorded (or imported). The offset has a second tab for the home loan.
import * as S from './store.js';
import { esc, money, sum, periodOf, shiftPeriod, fromISO, fmtDate, relDay, toISO, download } from './util.js';
import { txInPeriod } from './calc.js';
import { sheetHead } from './ui.js';

// What a payment does to the balance shown: owing goes up with card spending.
const effect = (t, credit) => (t.type === 'in' ? 1 : -1) * t.amount * (credit ? -1 : 1);
const isLoan = t => t.accountPart === 'loan';

export function statementHtml(acc, key, part = '') {
  const p = periodOf(key);
  const credit = acc.kind === 'credit';
  const loan = part === 'loan';
  const belongs = t => t.accountId === acc.id && (loan ? isLoan(t) : !isLoan(t));
  const all = S.list('transactions').filter(belongs);
  const txs = txInPeriod(p).filter(belongs).sort((a, b) => a.date.localeCompare(b.date));
  const inn = sum(txs.filter(t => t.type === 'in'), t => t.amount), out = sum(txs.filter(t => t.type === 'out'), t => t.amount);

  // Balance at the end of a day, from the closest recorded balance.
  const hist = (acc.history || []).map(h => ({ date: h.date, v: loan ? h.loan : h.balance })).filter(h => h.v != null);
  const balAt = iso => {
    if (!hist.length) return null;
    const anchor = hist.reduce((best, h) => (Math.abs(fromISO(h.date) - fromISO(iso)) < Math.abs(fromISO(best.date) - fromISO(iso)) ? h : best));
    // loans: repayments (money in to the loan) bring the owing down, like a card
    const eff = t => effect(t, credit || loan);
    if (anchor.date <= iso) return anchor.v + sum(all.filter(t => t.date > anchor.date && t.date <= iso), eff);
    return anchor.v - sum(all.filter(t => t.date > iso && t.date <= anchor.date), eff);
  };
  const dayBefore = toISO(new Date(p.start.getFullYear(), p.start.getMonth(), p.start.getDate() - 1));
  const lastDay = toISO(new Date(p.end.getFullYear(), p.end.getMonth(), p.end.getDate() - 1));
  const opening = balAt(dayBefore), closing = balAt(lastDay < toISO(new Date()) ? lastDay : toISO(new Date()));
  const fmtBal = v => (v == null ? '—' : credit || loan ? `<span class="neg">${money(Math.abs(v))}</span>` : v < 0 ? `<span class="neg">−${money(-v)}</span>` : money(v));

  const days = {};
  for (const t of txs) (days[t.date] ||= []).push(t);
  const body = Object.keys(days).sort().reverse().map(d => `
    <div class="day-head"><span>${relDay(d)}</span><span class="stmt-bal">${hist.length ? `Balance ${fmtBal(balAt(d))}` : ''}</span></div>
    <div class="card list">${days[d].map(t => {
      const c = S.cat(t.categoryId);
      const transfer = c.type === 'transfer';
      return `<button class="tx" data-action="editTx" data-id="${t.id}">
        <span class="tx-ic" style="--c:${S.memberColor(t.member)}">${c.icon}</span>
        <span class="tx-main"><b>${esc(t.bankDesc || t.desc)}</b><small>${esc(c.name)}${t.member ? ` · ${esc(t.member)}` : ''}</small></span>
        <span class="tx-amt ${transfer ? 'transfer' : t.type}">${t.type === 'in' ? '+' : '−'}${money(t.amount)}</span></button>`;
    }).join('')}</div>`).join('');

  const tabs = acc.kind === 'offset' ? `<div class="seg small stmt-tabs" role="tablist">${[['', acc.name], ['loan', 'Home loan']].map(([v, l]) =>
    `<label><input type="radio" name="stmtPart" value="${v}" ${part === v ? 'checked' : ''} data-change="stmtPart" data-id="${acc.id}" data-key="${key}"><span>${esc(l)}</span></label>`).join('')}</div>` : '';
  const nav = d => `data-action="statement" data-id="${acc.id}" data-key="${shiftPeriod(key, d)}" data-part="${part}"`;
  const inLabel = credit ? 'Payments & refunds' : loan ? 'Repayments' : 'Money in';
  const outLabel = credit ? 'Purchases' : loan ? 'Interest & fees' : 'Money out';
  return `${sheetHead(`📄 ${acc.name}${loan ? ' — home loan' : ''}`, 'Statement')}
    ${tabs}
    <div class="stmt-nav"><button class="icon-btn" ${nav(-1)} aria-label="Previous month">‹</button><b>${esc(p.label)}</b><button class="icon-btn" ${nav(1)} aria-label="Next month">›</button></div>
    <div class="stmt-sum">
      <div><small>Opening balance</small><b>${fmtBal(opening)}</b></div>
      <div><small>${inLabel}</small><b class="pos">+${money(inn)}</b></div>
      <div><small>${outLabel}</small><b>−${money(out)}</b></div>
      <div><small>${p.end > new Date() ? 'Balance now' : 'Closing balance'}</small><b>${fmtBal(closing)}</b></div>
    </div>
    ${hist.length ? '' : '<p class="small muted">Balances show once you\'ve updated this account\'s balance or imported a statement with one.</p>'}
    ${body || `<div class="card">${`<div class="empty"><span class="e-ic">📄</span>Nothing for ${esc(acc.name)}${loan ? ' home loan' : ''} in ${esc(p.label)}.<br><span class="small muted">Import a statement for this account and choose it in the Account box.</span></div>`}</div>`}
    ${txs.length ? `<p class="small muted">Balances are worked out from your last recorded balance, so they're exact once every payment for this account is imported. Tap a payment to change it.</p>
    <div class="form-actions"><button class="btn" data-action="statementCsv" data-id="${acc.id}" data-key="${key}" data-part="${part}">Download as CSV</button></div>` : ''}`;
}

export function statementCsv(acc, key, part = '') {
  const p = periodOf(key);
  const txs = txInPeriod(p).filter(t => t.accountId === acc.id && (part === 'loan' ? isLoan(t) : !isLoan(t))).sort((a, b) => a.date.localeCompare(b.date));
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Description', 'Category', 'Who', 'Money in', 'Money out'],
    ...txs.map(t => [t.date, t.bankDesc || t.desc, S.cat(t.categoryId).name, t.member || '', t.type === 'in' ? t.amount.toFixed(2) : '', t.type === 'out' ? t.amount.toFixed(2) : ''])];
  download(`${acc.name.replace(/[^\w]+/g, '-')}-${key}${part ? '-loan' : ''}.csv`, rows.map(r => r.map(q).join(',')).join('\n'), 'text/csv');
}
