// Credit card: what went on the card each month and what you paid off.
// Repayments are transfers, so they never count as spending (the purchases
// already did) — this just adds them up so you can see the card going down.
import * as S from './store.js';
import { esc, money, sum, periodOf, shiftPeriod, currentPeriodKey, fromISO, fmtDate } from './util.js';
import { txInPeriod } from './calc.js';
import { normalise } from './categorise.js';

const CARD_WORDS = ['credit card', 'card repayment', 'card payment', 'cc payment', 'payment thank', 'thank you payment', 'payment received', 'visa payment', 'mastercard payment', 'amex payment'];
const looksLikeCard = (desc, card) => {
  const d = ' ' + normalise(desc) + ' ';
  return CARD_WORDS.some(w => d.includes(w)) || (card.last4 && d.replace(/\D/g, ' ').split(' ').some(x => x.length >= 4 && x.endsWith(card.last4)));
};

export function cardMonth(card, key) {
  const txs = txInPeriod(periodOf(key));
  const onCard = txs.filter(t => t.accountId === card.id);
  const spent = sum(onCard.filter(t => t.type === 'out' && !S.isTransfer(t.categoryId)), t => t.amount);
  // Best source: repayments as they land on the card's own statement. If the
  // card statement isn't imported, use the transfers out of your other accounts.
  let payments = onCard.filter(t => t.type === 'in' && S.isTransfer(t.categoryId)).map(t => ({ t, from: fromAccount(t, txs, card) }));
  let side = 'card';
  if (!payments.length) {
    payments = txs.filter(t => t.type === 'out' && t.accountId !== card.id && S.isTransfer(t.categoryId) && looksLikeCard(t.desc, card))
      .map(t => ({ t, from: S.byId('accounts', t.accountId) }));
    side = 'bank';
  }
  return { key, spent, paid: sum(payments, x => x.t.amount), payments, side, cardImported: onCard.length > 0 };
}

// The other half of a repayment: the same amount leaving another account within 2 days.
function fromAccount(t, txs, card) {
  const twin = txs.find(x => x.type === 'out' && x.accountId && x.accountId !== card.id && Math.abs(x.amount - t.amount) < 0.005 &&
    Math.abs(fromISO(x.date) - fromISO(t.date)) <= 2 * 864e5);
  return twin ? S.byId('accounts', twin.accountId) : null;
}

export const cards = () => S.list('accounts').filter(a => a.kind === 'credit');

// Lines under the card's balance on Home / Savings.
export function cardLines(card) {
  const m = cardMonth(card, currentPeriodKey());
  if (!m.paid && !m.spent) return `<button class="link small card-link" data-action="cardSheet" data-id="${card.id}">💸 Repayments &amp; card spending ›</button>`;
  const diff = m.paid - m.spent;
  return `<div class="card-month">
    <div class="acc-line"><span>💳 Spent on card this month</span><b>${m.cardImported ? money(m.spent) : '—'}</b></div>
    <div class="acc-line"><span>💸 Paid off this month</span><b class="pos">${money(m.paid)}</b></div>
    ${m.cardImported ? `<p class="small status ${diff >= 0 ? 'good' : 'warn'}">${diff >= 0 ? `✓ Paid off ${money(diff, { whole: true })} more than you put on it` : `● ${money(-diff, { whole: true })} more went on than came off so far`}</p>` : ''}
    <button class="link small card-link" data-action="cardSheet" data-id="${card.id}">See every month ›</button>
  </div>`;
}

export function cardSheetHtml(card, { sheetHead, inOutBars }) {
  const now = currentPeriodKey();
  const months = Array.from({ length: 12 }, (_, i) => cardMonth(card, shiftPeriod(now, i - 11))).filter((m, i, all) => m.paid || m.spent || all.slice(0, i).some(x => x.paid || x.spent));
  const cur = cardMonth(card, now);
  const label = k => periodOf(k).start.toLocaleDateString('en-AU', { month: 'short' });
  const yearPaid = sum(months.filter(m => m.key.slice(0, 4) === now.slice(0, 4)), m => m.paid);
  const avg = months.length > 1 ? sum(months.slice(0, -1), m => m.paid) / (months.length - 1) : cur.paid;
  return `${sheetHead(`💳 ${card.name}`, 'Spending on the card and paying it off')}
    <div class="in-summary">
      <div><small>Paid off this month</small><b>${money(cur.paid)}</b><small>${cur.payments.length} repayment${cur.payments.length === 1 ? '' : 's'}</small></div>
      <div><small>Paid off this year</small><b>${money(yearPaid, { whole: true })}</b><small>about ${money(avg, { whole: true })} a month</small></div>
    </div>
    ${months.length ? `<div class="legend inline"><div class="legend-row"><i style="background:var(--s1)"></i><span>Paid off</span></div><div class="legend-row"><i style="background:var(--s2)"></i><span>Spent on card</span></div></div>
    <div class="chart">${inOutBars(months.map(m => ({ label: label(m.key), in: m.paid, out: m.spent })), { h: 170, names: ['paid off', 'spent'] })}</div>
    <div class="card list">${months.slice().reverse().map(m => {
      const diff = m.paid - m.spent;
      return `<div class="card-row"><b>${periodOf(m.key).label}</b>
        <span><small>Spent</small>${m.cardImported ? money(m.spent, { whole: true }) : '—'}</span>
        <span><small>Paid off</small><b class="pos">${money(m.paid, { whole: true })}</b></span>
        <span><small>Card</small>${m.cardImported ? `<b class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '▼' : '▲'} ${money(Math.abs(diff), { whole: true })}</b>` : '—'}</span></div>`;
    }).join('')}</div>` : ''}
    <div class="section-title"><span>Repayments this month</span><span>${money(cur.paid)}</span></div>
    ${cur.payments.length ? `<div class="card list">${cur.payments.map(({ t, from }) => `<button class="tx" data-action="editTx" data-id="${t.id}">
      <span class="tx-ic">💸</span><span class="tx-main"><b>${esc(t.desc)}</b><small>${fmtDate(t.date, { weekday: 'short', day: 'numeric', month: 'short' })}${from ? ` · from ${esc(from.name)}` : ''}</small></span>
      <span class="tx-amt transfer">⇄ ${money(t.amount)}</span></button>`).join('')}</div>` : '<p class="small muted">No repayments found yet this month.</p>'}
    <p class="small muted">Repayments are picked up from your card statement (“PAYMENT THANK YOU”) or from transfers out of your other accounts that mention the card. They're moving your own money, so they never count as spending — the purchases on the card already did.
    ${cards().length && !cur.cardImported ? ' Import your credit card statement too to see what went on the card.' : ''}</p>`;
}
