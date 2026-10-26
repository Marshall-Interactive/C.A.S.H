// The main screens. Each returns an HTML string for <main>.
import * as S from './store.js';
import { esc, money, sum, periodOf, shiftPeriod, relDay, fmtDate, perMonth, FREQS, fromISO, todayISO } from './util.js';
import { txInPeriod, spentByCategory, totals, billsInPeriod, incomesInPeriod, expectedIn, nextDue, incomeAmount } from './calc.js';
import { donut, inOutBars } from './charts.js';
import { icon, view } from './ui.js';
import * as Sync from './sync.js';

export const TITLES = { home: 'Home', activity: 'Activity', plan: 'Plan', savings: 'Savings', settings: 'Settings' };

export const NAV = [
  ['home', 'Home', 'home'],
  ['activity', 'Activity', 'list'],
  ['plan', 'Plan', 'plan'],
  ['savings', 'Savings', 'target'],
];

export function topbar(route) {
  const showMonth = ['home', 'activity', 'plan'].includes(route);
  const p = periodOf(view.period);
  return `<div class="topbar-inner">
    <a class="brand-sm" href="#home" aria-label="C.A.S.H home"><img src="icons/logo.svg" alt=""></a>
    <div class="tb-title"><h1>${TITLES[route] || ''}</h1><small>${esc(S.settings().householdName)} · ${who(S.settings().currentMember)}</small></div>
    ${showMonth ? `<div class="month-switch" title="${esc(p.range)}">
      <button class="icon-btn" data-action="prevPeriod" aria-label="Previous month">${icon('chevL', 18)}</button>
      <button class="month-label" data-action="thisPeriod" title="Back to this month">${esc(p.short)}</button>
      <button class="icon-btn" data-action="nextPeriod" aria-label="Next month">${icon('chevR', 18)}</button></div>` : ''}
    ${syncDot()}<a class="icon-btn" href="#settings" aria-label="Settings">${icon('gear')}</a>
  </div>`;
}

// ---------- shared pieces ----------
// A person's name with their chosen colour dot.
export const who = name => name
  ? `<span class="who" style="--c:${S.memberColor(name)}"><i></i>${esc(name)}</span>` : '';

export function txRow(t) {
  const c = S.cat(t.categoryId);
  const transfer = c.type === 'transfer';
  const split = t.splits?.length > 1 ? `<span class="badge">split ${t.splits.length}</span>` : '';
  const src = { receipt: 'receipt', screenshot: 'screenshot', csv: 'bank', pdf: 'bank', bill: 'bill', income: 'wage' }[t.source];
  const acc = t.accountId ? S.byId('accounts', t.accountId) : null;
  return `<button class="tx" data-action="editTx" data-id="${t.id}">
    <span class="tx-ic" style="--c:${S.memberColor(t.member)}">${c.icon}</span>
    <span class="tx-main"><b>${esc(t.desc)}</b><small>${who(t.member)} ${esc(c.name)}${split}${acc ? `<span class="badge">${esc(acc.name)}</span>` : src ? `<span class="badge">${src}</span>` : ''}</small></span>
    <span class="tx-amt ${transfer ? 'transfer' : t.type}">${transfer ? '⇄ ' : t.type === 'in' ? '+' : '−'}${money(t.amount)}</span>
  </button>`;
}

function status(spent, budget) {
  if (!budget) return { cls: 'none', text: spent ? money(spent) + ' spent' : 'No budget set' };
  const r = spent / budget;
  if (r > 1) return { cls: 'bad', text: `⚠ ${money(spent - budget)} over` };
  if (r >= 0.8) return { cls: 'warn', text: `● ${money(budget - spent)} left` };
  return { cls: 'good', text: `✓ ${money(budget - spent)} left` };
}

function catRow(c, spent) {
  const st = status(spent, c.budget);
  const pct = c.budget ? Math.min(100, (spent / c.budget) * 100) : 0;
  return `<button class="cat-row" data-action="editCategory" data-id="${c.id}">
    <span class="tx-ic">${c.icon}</span>
    <span><span class="nm">${esc(c.name)}</span><br><span class="status ${st.cls}">${st.text}</span></span>
    <span class="vals"><b>${money(spent, { whole: true })}</b><br>of ${money(c.budget, { whole: true })}</span>
    <span class="bar"><i class="${st.cls}" style="width:${pct}%"></i></span>
  </button>`;
}

// ---------- accounts (offset + home loan, credit card, main…) ----------
export const KINDS = {
  offset: ['🏦', 'Offset account'], savings: ['💰', 'Savings account'],
  everyday: ['👛', 'Main account'], credit: ['💳', 'Credit card'],
};

// Money you owe shows as a red minus figure, e.g. −$354,358.27
const owed = v => `<span class="neg">${money(-Math.abs(v))}</span>`;
const signed = v => v < 0 ? `<span class="neg">${money(v)}</span>` : money(v);

function accountFacts(a) {
  const set = a.balance != null;
  const hist = a.history || [];
  const last = hist[hist.length - 1];
  const prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const credit = a.kind === 'credit';
  let change = '';
  if (set && prev && prev.balance != null) {
    const diff = a.balance - prev.balance;
    const good = credit ? diff < 0 : diff > 0;
    if (Math.abs(diff) >= 0.01) change = `<span class="${good ? 'pos' : 'neg'}">${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))}</span> since ${fmtDate(prev.date)}`;
  }
  // the headline figure and the lines underneath it
  const big = !set ? '—' : credit ? owed(a.balance) : signed(a.balance);
  const label = credit ? 'Amount owing' : a.kind === 'offset' ? 'Offset balance' : 'Balance';
  const lines = [];
  let bar = '';
  if (credit) {
    const avail = a.available ?? (a.limit && set ? a.limit - a.balance : null);
    if (avail != null) lines.push(`<div class="acc-line"><span>Available balance</span><b>${money(avail)}</b></div>`);
    if (a.limit && set) {
      const pct = Math.min(100, (a.balance / a.limit) * 100);
      const cls = pct >= 80 ? 'bad' : pct >= 50 ? 'warn' : 'good';
      bar = `<div class="bar"><i class="${cls}" style="width:${pct}%"></i></div>`;
      lines.push(`<p class="small status ${cls}">${cls === 'good' ? '✓' : cls === 'warn' ? '●' : '⚠'} ${Math.round(pct)}% of your ${money(a.limit, { whole: true })} limit used</p>`);
    } else if (!a.limit && a.available == null) lines.push('<p class="small muted">Add the card limit (or the available balance when you update) to see what is left</p>');
  }
  if (a.kind === 'offset') {
    if (a.loanBalance != null) {
      lines.push(`<div class="acc-line"><span>Home loan balance</span><b>${owed(a.loanBalance)}</b></div>`);
      if (set) lines.push(`<div class="acc-line"><span>Owing after offset</span><b>${owed(Math.max(0, a.loanBalance - a.balance))}</b></div>`);
    } else lines.push('<p class="small muted">Tap Update to add your home loan balance</p>');
    lines.push(set && a.rate
      ? `<p class="small">Offset saving you about <b>${money((a.balance * a.rate) / 100 / 12)}</b> interest a month</p>`
      : '<p class="small muted">Add your home-loan rate to see the interest it saves</p>');
  }
  const stale = !last || (Date.now() - fromISO(last.date)) > 3 * 864e5;
  const day = last && relDay(last.date);
  const updated = last ? `Updated ${/^(Today|Yesterday)$/.test(day) ? day.toLowerCase() : fmtDate(last.date)} ${who(last.by)}` : 'Not updated yet';
  return { set, credit, change, big, label, lines: lines.join(''), bar, updated, stale, hist };
}

function accountMini(a) {
  const f = accountFacts(a);
  const [ic] = KINDS[a.kind] || KINDS.everyday;
  return `<div class="acc-mini ${f.stale ? 'stale' : ''}">
    <div class="acc-top"><span>${ic} ${esc(a.name)}</span><button class="btn sm" data-action="updateBalance" data-id="${a.id}">Update</button></div>
    <small class="muted">${f.label}</small>
    <div class="acc-bal">${f.big}</div>
    ${f.bar}${f.lines}
    <p class="small muted">${f.updated}${f.change ? ' · ' + f.change : ''}</p>
  </div>`;
}

export function accountCard(a) {
  const f = accountFacts(a);
  const [ic, label] = KINDS[a.kind] || KINDS.everyday;
  return `<section class="card account">
    <button class="pot-head" data-action="editAccount" data-id="${a.id}">
      <span class="pot-ic acc">${ic}</span>
      <span><b>${esc(a.name)}</b><small>${label}${a.last4 ? ` ·· ${esc(a.last4)}` : ''}${a.kind === 'offset' && a.rate ? ` · ${a.rate}% loan rate` : ''}</small></span>
    </button>
    <small class="muted acc-label">${f.label}</small>
    <div class="acc-bal big">${f.big}</div>
    ${f.bar}${f.lines}
    <p class="small muted">${f.updated}${f.change ? ' · ' + f.change : ''}</p>
    ${f.stale ? '<p class="notice small">● Time for an update — type the figures from your NAB app, or import a NAB statement.</p>' : ''}
    ${f.hist.length > 1 ? `<div class="pot-entries">${f.hist.slice(-5).reverse().map(h => `<div><span>${fmtDate(h.date)} ${who(h.by)}</span><b>${h.balance == null ? '—' : f.credit ? owed(h.balance) : signed(h.balance)}</b></div>`).join('')}</div>` : ''}
    <div class="btn-row"><button class="btn sm primary" data-action="updateBalance" data-id="${a.id}">Update</button></div>
  </section>`;
}

function accountsHome() {
  const accs = S.list('accounts');
  if (!accs.length) return '';
  const cash = sum(accs.filter(a => a.kind !== 'credit'), a => a.balance || 0);
  const cards = sum(accs.filter(a => a.kind === 'credit'), a => a.balance || 0);
  return `<section class="card span2">
    <h2>Accounts <a href="#savings">Details</a></h2>
    <div class="acc-grid">${accs.map(accountMini).join('')}</div>
    ${cards && cash ? `<p class="small muted mt">Cash minus card debt: <b>${signed(cash - cards)}</b></p>` : ''}
  </section>`;
}

const empty = (ic, text, action = '') => `<div class="empty"><span class="e-ic">${ic}</span>${text}${action}</div>`;

// ---------- Home pie: income / spending areas / categories ----------
export const PIE_MODES = [['income', 'Income'], ['areas', 'Spending areas'], ['categories', 'Categories']];

// Spending (incl. savings) per area, with anything in a deleted area counted as Ungrouped.
function byArea(spent) {
  const gs = S.groups();
  const rows = gs.map(g => ({ ...g, value: 0 }));
  const loose = { id: 'ungrouped', name: 'Ungrouped', color: 'var(--line-2)', savings: false, value: 0 };
  for (const [id, v] of Object.entries(spent)) {
    const c = S.byId('categories', id);
    const row = rows.find(r => r.id === (c ? c.group : 'other')) || loose;
    row.value += v;
  }
  return loose.value > 0.004 ? [...rows, loose] : rows;
}

function moneyPie(spent, t, base) {
  const mode = view.pieMode || 'income';
  const areas = byArea(spent);
  const saved = sum(areas.filter(a => a.savings), a => a.value);
  const spending = sum(areas.filter(a => !a.savings), a => a.value);
  let segs = [], center = '', sub = '', note = '', heading = '';
  if (mode === 'income') {
    const left = Math.max(0, base - spending - saved);
    segs = [
      { label: 'Spent', value: spending, color: 'var(--s2)' },
      { label: 'Saved', value: saved, color: 'var(--s3)' },
      { label: 'Left over', value: left, color: 'var(--line-2)' },
    ].filter(s => s.value > 0.004);
    center = money(base, { whole: true }); sub = 'coming in';
    if (base && spending + saved > base) note = `<p class="status bad small">⚠ Spending is ${money(spending + saved - base)} more than came in</p>`;
    if (!base) note = '<p class="small muted">Add your wages in Plan → Wages to see your income split.</p>';
  } else if (mode === 'areas') {
    segs = areas.filter(a => a.value > 0.004).map(a => ({ id: a.id, label: a.name + (a.savings ? ' (saved)' : ''), value: a.value, color: a.color }));
    center = money(t.out, { whole: true }); sub = 'out';
    note = '<p class="small muted">Tap an area to see what\'s inside it.</p>';
  } else {
    const g = view.pieGroup && S.groups().find(x => x.id === view.pieGroup);
    const rows = Object.entries(spent).filter(([id, v]) => v > 0.004 && (!g || S.cat(id).group === g.id)).sort((a, b) => b[1] - a[1]);
    // the 7 biggest get their own colour; the rest fold into "Everything else"
    segs = rows.slice(0, 7).map(([id, v], i) => ({ label: `${S.cat(id).icon} ${S.cat(id).name}`, value: v, color: `var(--s${i + 1})` }));
    const rest = sum(rows.slice(7), ([, v]) => v);
    if (rest > 0.004) segs.push({ label: `Everything else (${rows.length - 7})`, value: rest, color: 'var(--line-2)' });
    center = money(sum(rows, ([, v]) => v), { whole: true }); sub = g ? g.name : 'out';
    if (g) heading = `<button class="link" data-action="pieBack">← All spending areas</button>`;
  }
  const total = sum(segs, s => s.value);
  const legend = segs.map(s => {
    const pct = total ? Math.round((s.value / total) * 100) : 0;
    const inner = `<i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${money(s.value, { whole: true })}</b><small>${pct}%</small>`;
    return s.id ? `<button class="legend-row pie-row" data-action="pieDrill" data-id="${s.id}">${inner}</button>` : `<div class="legend-row pie-row">${inner}</div>`;
  }).join('');
  return `<section class="card span2 pie-card">
    <h2>Where the money goes</h2>
    <div class="pie-layout">
      <div class="chart pie-chart">${donut(segs, { size: 200, thick: 30, center, sub })}</div>
      <div class="pie-side">
        <div class="seg small pie-modes" role="radiogroup" aria-label="Show">${PIE_MODES.map(([v, l]) => `<label><input type="radio" name="pieMode" value="${v}" ${mode === v ? 'checked' : ''} data-change="pieMode"><span>${l}</span></label>`).join('')}</div>
        ${heading}
        <div class="legend">${legend || '<p class="small muted">Nothing to show for this month yet.</p>'}</div>
        ${note}
      </div>
    </div>
  </section>`;
}

// ---------- Home ----------
export function home() {
  const p = periodOf(view.period);
  const txs = txInPeriod(p);
  const t = totals(txs);
  const expIn = expectedIn(p);
  // Until the month is over, count wages that are still due to land.
  const useExpected = expIn > t.in && p.end > new Date();
  const base = useExpected ? expIn : t.in;
  const left = base - t.out;
  const pct = base ? Math.min(100, (t.out / base) * 100) : 0;
  const spent = spentByCategory(txs);
  const outCats = S.list('categories').filter(c => (c.type || 'out') === 'out');

  // Hero
  const hero = `<section class="card hero span2">
    <div class="hero-top"><span class="label">${left >= 0 ? 'Left this month' : 'Overspent this month'}</span><span class="label">${esc(p.range)}</span></div>
    <div class="big">${money(left)}</div>
    <div class="sub">${useExpected ? `Counting ${money(expIn - t.in, { whole: true })} of wages still to come` : base ? `You've spent ${Math.round(pct)}% of what came in` : 'Add your wages to see what is left'}</div>
    <div class="meter" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    <div class="hero-stats">
      <div class="hero-stat"><small>↓ Money in</small><b>${money(t.in)}</b><small>${expIn ? 'of ' + money(expIn) + ' expected' : 'this month'}</small></div>
      <div class="hero-stat"><small>↑ Money out</small><b>${money(t.out)}</b><small>${t.count} payments</small></div>
    </div>
  </section>`;

  // Where the money goes: one pie, three ways of looking at it.
  const pie = moneyPie(spent, t, base);

  // Budget watch
  const budgetTotal = sum(outCats, c => c.budget);
  const watch = outCats.filter(c => c.budget > 0 && spent[c.id])
    .sort((a, b) => spent[b.id] / b.budget - spent[a.id] / a.budget).slice(0, 4);
  const bst = status(t.out, budgetTotal);
  const budget = `<section class="card">
    <h2>Budget <a href="#plan/budget">See all</a></h2>
    <div class="budget-total"><b>${money(t.out, { whole: true })}</b> <span>of ${money(budgetTotal, { whole: true })} budgeted</span></div>
    <div class="bar big"><i class="${bst.cls}" style="width:${budgetTotal ? Math.min(100, (t.out / budgetTotal) * 100) : 0}%"></i></div>
    <p class="status ${bst.cls}">${bst.text}</p>
    ${watch.length ? watch.map(c => catRow(c, spent[c.id] || 0)).join('') : '<p class="muted small">Categories you spend in will show here.</p>'}
  </section>`;

  // Bills coming up
  const bills = billsInPeriod(p);
  const unpaid = bills.filter(b => !b.done);
  const billsCard = `<section class="card">
    <h2>Bills this month <a href="#plan/bills">All bills</a></h2>
    <div class="stat-row"><div class="stat"><small>Due</small><b>${money(sum(bills, b => b.item.amount))}</b></div>
      <div class="stat"><small>Still to pay</small><b>${money(sum(unpaid, b => b.item.amount))}</b></div></div>
    ${bills.length ? unpaid.slice(0, 5).map(billRow).join('') || '<p class="status good">✓ All bills paid this month</p>'
      : empty('📄', 'Add your bills to see what is due.', `<br><button class="btn sm" data-action="newBill">Add a bill</button>`)}
  </section>`;

  // Recent
  const recent = `<section class="card">
    <h2>Recent <a href="#activity">See all</a></h2>
    ${txs.length ? txs.slice(0, 6).map(txRow).join('') : empty('✨', 'Nothing here yet for this month.')}
  </section>`;

  // Trend
  const rows = [];
  for (let k = -5; k <= 0; k++) {
    const pk = periodOf(shiftPeriod(view.period, k));
    const tt = totals(txInPeriod(pk));
    rows.push({ label: pk.start.toLocaleDateString('en-AU', { month: 'short' }), in: tt.in, out: tt.out });
  }
  const trend = `<section class="card">
    <h2>Last 6 months</h2>
    <div class="legend inline"><div class="legend-row"><i style="background:var(--s1)"></i><span>Money in</span></div><div class="legend-row"><i style="background:var(--s2)"></i><span>Money out</span></div></div>
    <div class="chart">${inOutBars(rows)}</div>
  </section>`;

  // Who spent
  const members = S.settings().members;
  const byMember = members.map(m => ({ m, v: sum(txs.filter(x => x.type === 'out' && !S.isTransfer(x.categoryId) && x.member === m), x => x.amount) }));
  const unassigned = t.out - sum(byMember, x => x.v);
  if (unassigned > 0.01) byMember.push({ m: 'Joint / not set', v: unassigned });
  const bmMax = Math.max(...byMember.map(x => x.v), 1);
  const whoCard = `<section class="card">
    <h2>Who spent</h2>
    <div class="hbar">${byMember.map(x => `<span>${who(x.m)}</span><span class="track"><i style="width:${(x.v / bmMax) * 100}%;background:${S.memberColor(x.m)}"></i></span><b>${money(x.v, { whole: true })}</b>`).join('')}</div>
  </section>`;

  return `<div class="grid cols">${hero}${pie}${accountsHome()}${budget}${billsCard}${recent}${trend}${whoCard}</div>`;
}

export function billRow(r) {
  const b = r.item, d = fromISO(r.date);
  const late = !r.done && r.date < todayISO();
  return `<div class="bill ${r.done ? 'is-paid' : ''}">
    <div class="due ${late ? 'late' : ''}"><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-AU', { month: 'short' })}</small></div>
    <button class="bill-main" data-action="editBill" data-id="${b.id}">
      <b>${S.cat(b.categoryId).icon} ${esc(b.name)}</b>
      <small>${esc(b.method || '')}${b.payer ? ' · ' + esc(b.payer) : ''}${late ? ' · <span class="status bad">overdue?</span>' : ''}</small>
    </button>
    <span class="tx-amt">${money(b.amount)}</span>
    <button class="paid-btn ${r.done ? 'on' : ''}" data-action="toggleBill" data-id="${b.id}" data-date="${r.date}" aria-label="${r.done ? 'Mark unpaid' : 'Mark paid'}" title="${r.done ? 'Paid — tap to undo' : 'Mark as paid'}">${icon('check', 18)}</button>
  </div>`;
}

// ---------- Activity ----------
export function activity() {
  const f = view.filters;
  const cats = S.list('categories');
  const members = S.settings().members;
  return `<div class="toolbar">
      <div class="search">${icon('search', 18)}<input type="search" placeholder="Search payments" value="${esc(f.q)}" data-input="search" aria-label="Search payments"></div>
      <div class="seg small" role="radiogroup" aria-label="Type">
        ${[['all', 'All'], ['out', 'Out'], ['in', 'In']].map(([v, l]) => `<label><input type="radio" name="ftype" value="${v}" ${f.type === v ? 'checked' : ''} data-change="filterType"><span>${l}</span></label>`).join('')}
      </div>
      <select data-change="filterCat" aria-label="Category"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}" ${f.categoryId === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select>
      <select data-change="filterMember" aria-label="Person"><option value="">Everyone</option>${members.map(m => `<option ${f.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    </div>
    <div id="tx-list">${txList()}</div>`;
}

export function txList() {
  const f = view.filters;
  const q = f.q.trim().toLowerCase();
  const txs = txInPeriod(periodOf(view.period)).filter(t =>
    (f.type === 'all' || t.type === f.type) &&
    (!f.categoryId || t.categoryId === f.categoryId || t.splits?.some(s => s.categoryId === f.categoryId)) &&
    (!f.member || t.member === f.member) &&
    (!q || t.desc.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || String(t.amount).includes(q)));
  if (!txs.length) return `<div class="card">${empty('🔍', 'No payments match for this month.', `<br><button class="btn sm" data-action="openAdd">Add one</button>`)}</div>`;
  const t = totals(txs);
  let html = `<div class="stat-row"><div class="stat"><small>${txs.length} payments · in</small><b class="pos">${money(t.in)}</b></div><div class="stat"><small>Out</small><b>${money(t.out)}</b></div></div>`;
  const days = {};
  txs.forEach(x => (days[x.date] ||= []).push(x));
  for (const [d, list] of Object.entries(days)) {
    const dayOut = sum(list.filter(x => x.type === 'out' && !S.isTransfer(x.categoryId)), x => x.amount);
    html += `<div class="day-head"><span>${relDay(d)}</span><span>${dayOut ? '−' + money(dayOut) : ''}</span></div><div class="card list">${list.map(txRow).join('')}</div>`;
  }
  return html;
}

// ---------- Plan: budget, bills, wages ----------
export function plan(tab = view.planTab) {
  view.planTab = tab;
  const tabs = [['budget', 'Budget'], ['bills', 'Bills'], ['wages', 'Wages']];
  const body = tab === 'bills' ? billsTab() : tab === 'wages' ? wagesTab() : budgetTab();
  return `<nav class="tabs">${tabs.map(([id, l]) => `<a href="#plan/${id}" class="${tab === id ? 'active' : ''}">${l}</a>`).join('')}</nav>${body}`;
}

function budgetTab() {
  const p = periodOf(view.period);
  const spent = spentByCategory(txInPeriod(p));
  const cats = S.list('categories').filter(c => (c.type || 'out') === 'out');
  const expIn = expectedIn(p) || sum(S.list('incomes'), i => perMonth(incomeAmount(i), i.frequency));
  const budgeted = sum(cats, c => c.budget);
  const left = expIn - budgeted;
  const billsMonthly = sum(S.list('bills').filter(b => b.active !== false), b => perMonth(b.amount, b.frequency));
  let html = `<div class="grid cols"><section class="card span2">
    <h2>Your monthly plan</h2>
    <div class="stat-row">
      <div class="stat"><small>Expected income</small><b>${money(expIn, { whole: true })}</b></div>
      <div class="stat"><small>Budgeted</small><b>${money(budgeted, { whole: true })}</b></div>
      <div class="stat"><small>${left >= 0 ? 'Not yet given a job' : 'Over-planned by'}</small><b class="${left >= 0 ? 'pos' : 'neg'}">${money(Math.abs(left), { whole: true })}</b></div>
      <div class="stat"><small>Bills (monthly)</small><b>${money(billsMonthly, { whole: true })}</b></div>
    </div>
    ${!expIn ? `<p class="notice">Add your wages in the <a href="#plan/wages">Wages</a> tab so C.A.S.H can check your budget adds up.</p>` : ''}
    <div class="btn-row"><button class="btn" data-action="budgetHelper">✨ Budget helper (50/30/20)</button><button class="btn" data-action="newCategory">${icon('plus', 18)} Category</button></div>
  </section></div>`;
  const gs = S.groups();
  const known = new Set(gs.map(g => g.id));
  const loose = cats.filter(c => !known.has(c.group));
  for (const g of [...gs, ...(loose.length ? [S.group('ungrouped')] : [])]) {
    const gc = g.id === 'ungrouped' ? loose : cats.filter(c => c.group === g.id);
    const gs2 = sum(gc, c => spent[c.id] || 0), gb = sum(gc, c => c.budget);
    html += `<div class="section-title"><span><i class="dot" style="background:${g.color}"></i>${esc(g.name)}${g.savings && !/sav/i.test(g.name) ? ' <span class="badge">savings</span>' : ''}
        ${g.id !== 'ungrouped' ? `<button class="link" data-action="editGroup" data-id="${g.id}" aria-label="Edit ${esc(g.name)}">${icon('pen', 14)} Edit</button>` : ''}</span>
      <span>${money(gs2, { whole: true })} / ${money(gb, { whole: true })}</span></div>
      <div class="card list">${gc.map(c => catRow(c, spent[c.id] || 0)).join('') || '<p class="small muted empty-row">No categories here yet.</p>'}
        ${g.id !== 'ungrouped' ? `<button class="link add-row" data-action="newCategory" data-group="${g.id}">${icon('plus', 14)} Add a category to ${esc(g.name)}</button>` : ''}</div>`;
  }
  html += `<div class="btn-row"><button class="btn" data-action="newGroup">${icon('plus', 18)} Add a spending area</button></div>`;
  return html;
}

function billsTab() {
  const p = periodOf(view.period);
  const rows = billsInPeriod(p);
  const all = S.list('bills');
  const monthly = sum(all.filter(b => b.active !== false), b => perMonth(b.amount, b.frequency));
  const notThisMonth = all.filter(b => !rows.some(r => r.item.id === b.id));
  return `<section class="card">
      <div class="stat-row">
        <div class="stat"><small>Bills a month</small><b>${money(monthly)}</b></div>
        <div class="stat"><small>Bills a year</small><b>${money(monthly * 12, { whole: true })}</b></div>
        <div class="stat"><small>Paid this month</small><b>${rows.filter(r => r.done).length} of ${rows.length}</b></div>
      </div>
      <div class="btn-row"><button class="btn primary" data-action="newBill">${icon('plus', 18)} Add bill</button><button class="btn" data-action="findRegular">${icon('search', 18)} Find from my payments</button></div>
    </section>
    <div class="section-title"><span>Due in ${esc(p.label)}</span><span>${money(sum(rows, r => r.item.amount))}</span></div>
    <div class="card list">${rows.length ? rows.map(billRow).join('') : empty('📄', 'No bills due this month yet.<br>Add rent, council tax, energy, phones, subscriptions…')}</div>
    ${notThisMonth.length ? `<div class="section-title"><span>Not due this month</span></div><div class="card list">${notThisMonth.map(b => {
      const nd = nextDue(b);
      return `<button class="tx" data-action="editBill" data-id="${b.id}"><span class="tx-ic">${S.cat(b.categoryId).icon}</span>
        <span class="tx-main"><b>${esc(b.name)}</b><small>${FREQS[b.frequency] || ''}${b.active === false ? ' · paused' : nd ? ' · next ' + fmtDate(nd) : ''}</small></span>
        <span class="tx-amt">${money(b.amount)}</span></button>`;
    }).join('')}</div>` : ''}`;
}

function wagesTab() {
  const p = periodOf(view.period);
  const rows = incomesInPeriod(p);
  const received = sum(txInPeriod(p).filter(t => t.type === 'in' && !S.isTransfer(t.categoryId)), t => t.amount);
  return `<section class="card">
      <div class="stat-row">
        <div class="stat"><small>Expected this month</small><b>${money(sum(rows, r => incomeAmount(r.item)))}</b></div>
        <div class="stat"><small>Received so far</small><b class="pos">${money(received)}</b></div>
        <div class="stat"><small>Average a month</small><b>${money(sum(S.list('incomes'), i => perMonth(incomeAmount(i), i.frequency)), { whole: true })}</b></div>
      </div>
      <div class="btn-row"><button class="btn primary" data-action="newIncome">${icon('plus', 18)} Add wage / income</button><button class="btn" data-action="findRegular">${icon('search', 18)} Find from my payments</button></div>
    </section>
    <div class="section-title"><span>Paydays in ${esc(p.label)}</span></div>
    <div class="card list">${rows.length ? rows.map(r => {
      const i = r.item, d = fromISO(r.date);
      return `<div class="bill ${r.done ? 'is-paid' : ''}">
        <div class="due in"><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-AU', { month: 'short' })}</small></div>
        <button class="bill-main" data-action="editIncome" data-id="${i.id}"><b>💵 ${esc(i.name)}</b><small>${esc(i.member || '')} · ${FREQS[i.frequency] || ''}</small></button>
        <span class="tx-amt in">${i.varies ? '≈ ' : '+'}${money(incomeAmount(i))}</span>
        <button class="paid-btn ${r.done ? 'on' : ''}" data-action="toggleIncome" data-id="${i.id}" data-date="${r.date}" aria-label="${r.done ? 'Mark not received' : 'Mark received'}" title="${r.done ? 'Received — tap to undo' : 'Mark as received'}">${icon('check', 18)}</button>
      </div>`;
    }).join('') : empty('💵', 'Add each wage, Family Tax Benefit and other regular money coming in.')}</div>`;
}

// ---------- Savings ----------
export const potSaved = pot => sum(pot.entries || [], e => e.amount);

export function savings() {
  const pots = S.list('pots');
  const total = sum(pots, potSaved);
  const goal = sum(pots, p => +p.goal || 0);
  const accs = S.list('accounts');
  return `<div class="section-title first"><span>Accounts</span><span><button class="link" data-action="newAccount">${icon('plus', 14)} Add account</button></span></div>
    <div class="pots">${accs.map(accountCard).join('') || `<div class="card">${empty('🏦', 'Add your offset account and credit card to track their balances.')}</div>`}</div>
    <div class="section-title"><span>Savings pots</span></div>
  <div class="grid">
    <section class="card hero gold">
      <div class="hero-top"><span class="label">Total saved</span><span class="label">${pots.length} pot${pots.length === 1 ? '' : 's'}</span></div>
      <div class="big">${money(total)}</div>
      <div class="sub">${goal ? `${Math.round((total / goal) * 100)}% of your ${money(goal, { whole: true })} goals` : 'Create a pot for each thing you are saving for'}</div>
      <div class="meter"><i style="width:${goal ? Math.min(100, (total / goal) * 100) : 0}%"></i></div>
    </section>
    <div class="btn-row"><button class="btn primary" data-action="newPot">${icon('plus', 18)} New savings pot</button></div>
    <div class="pots">${pots.map(potCard).join('') || `<div class="card">${empty('🐷', 'No pots yet — try an Emergency fund, Holiday or Christmas pot.')}</div>`}</div>
  </div>`;
}

function potCard(p) {
  const saved = potSaved(p), goal = +p.goal || 0;
  const pct = goal ? Math.min(100, (saved / goal) * 100) : 0;
  let pace = '';
  if (goal && p.targetDate && saved < goal) {
    const months = Math.max(1, (fromISO(p.targetDate) - new Date()) / (864e5 * 30.44));
    pace = `Save <b>${money((goal - saved) / months)}</b> a month to reach it by ${fmtDate(p.targetDate, { month: 'short', year: 'numeric' })}`;
  } else if (goal && saved >= goal) pace = '<span class="status good">✓ Goal reached!</span>';
  const last = (p.entries || []).slice(-3).reverse();
  return `<section class="card pot">
    <button class="pot-head" data-action="editPot" data-id="${p.id}">
      <span class="pot-ic">${p.icon || '🐷'}</span>
      <span><b>${esc(p.name)}</b><small>${goal ? `${money(saved)} of ${money(goal, { whole: true })}` : money(saved)}</small></span>
    </button>
    <div class="bar big"><i class="good" style="width:${pct}%"></i></div>
    ${pace ? `<p class="small">${pace}</p>` : ''}
    ${last.length ? `<div class="pot-entries">${last.map(e => `<div><span>${fmtDate(e.date)} ${esc(e.note || '')}</span><b class="${e.amount >= 0 ? 'pos' : ''}">${money(e.amount, { sign: true })}</b></div>`).join('')}</div>` : ''}
    <div class="btn-row"><button class="btn sm primary" data-action="potIn" data-id="${p.id}">＋ Add money</button><button class="btn sm" data-action="potOut" data-id="${p.id}">− Take out</button></div>
  </section>`;
}

// ---------- Family sync ----------
const SYNC_TEXT = {
  ok: ['ok', '✓ Up to date'], syncing: ['busy', 'Syncing…'], offline: ['warn', '● Offline — will sync when you are back online'],
  error: ['bad', '⚠ Sync problem'], signedout: ['warn', 'Signed out'], nohousehold: ['warn', 'Not in a household yet'], off: ['', ''],
};

export function syncDot() {
  if (!Sync.configured()) return '';
  const [cls, text] = SYNC_TEXT[Sync.status.state] || SYNC_TEXT.off;
  return `<a href="#settings" class="sync-dot ${cls}" title="Family sync: ${esc(text)}" aria-label="Family sync: ${esc(text)}"></a>`;
}

function syncCard() {
  const st = Sync.status, c = Sync.conf();
  const head = `<h2><span class="h-ic">${icon('sync', 18)} Family sync</span></h2>`;
  if (!Sync.configured()) {
    return `${head}
      <p class="small">Share one live budget with your partner. Changes either of you make show up on the other phone within seconds.</p>
      <p class="small muted">First create a free Supabase project and run <b>supabase/setup.sql</b> (see the README). Then paste its details here, or put them in <b>js/config.js</b> so neither of you has to type them.</p>
      <form class="form" data-form="syncConfig">
        <label class="field"><span>Project URL</span><input name="url" placeholder="https://xxxx.supabase.co" required autocomplete="off" inputmode="url"></label>
        <label class="field"><span>Anon / publishable key</span><input name="key" placeholder="eyJ… or sb_publishable_…" required autocomplete="off"></label>
        <div class="form-actions"><button class="btn primary" type="submit">Connect</button></div>
      </form>`;
  }
  if (st.state === 'off' || (st.state === 'error' && !st.email)) {
    return `${head}<p class="status bad">⚠ Couldn't reach Supabase${st.message ? ': ' + esc(st.message) : ''}</p>
      <div class="btn-row"><button class="btn" data-action="syncNow">Try again</button><button class="btn ghost" data-action="syncForget">Change project details</button></div>`;
  }
  if (st.state === 'signedout') {
    return `${head}
      <p class="small">Each of you signs in with <b>your own</b> email and password.</p>
      <form class="form" data-form="syncSignIn">
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
        <div class="btn-row"><button class="btn primary" type="submit">Sign in</button><button class="btn" type="button" data-action="syncSignUp">Create my login</button></div>
      </form>
      <p class="small muted">New here? Tap <b>Create my login</b>, then confirm the email Supabase sends you.</p>
      <div class="btn-row"><button class="btn sm ghost" data-action="syncForget">Change project details</button></div>`;
  }
  if (st.state === 'nohousehold') {
    return `${head}
      <p class="small">Signed in as <b>${esc(st.email)}</b>.</p>
      <div class="sync-choice">
        <div><b>First of you to set up?</b><p class="small muted">Uploads everything on this phone and gives you a code for your partner.</p>
          <button class="btn primary" data-action="syncCreate">Start our household</button></div>
        <form class="form" data-form="syncJoin"><b>Partner already set up?</b><p class="small muted">Enter the code from their Settings. This phone then shows the household's data.</p>
          <input name="code" placeholder="Join code e.g. 4F9A21C7" required autocomplete="off" autocapitalize="characters" maxlength="8">
          <button class="btn" type="submit">Join household</button></form>
      </div>
      <div class="btn-row"><button class="btn sm ghost" data-action="syncSignOut">Sign out</button></div>`;
  }
  const [cls, text] = SYNC_TEXT[st.state] || SYNC_TEXT.ok;
  const ago = c.lastSync ? Math.round((Date.now() - c.lastSync) / 60000) : null;
  return `${head}
    <p class="status ${cls}">${text}${st.state === 'ok' && ago !== null ? ` · ${ago < 1 ? 'just now' : ago + ' min ago'}` : ''}${st.state === 'error' && st.message ? ': ' + esc(st.message) : ''}</p>
    <p class="small">Household <b>${esc(c.householdName || S.settings().householdName)}</b> · signed in as <b>${esc(st.email)}</b></p>
    ${c.joinCode ? `<div class="join-code"><small>Partner's join code</small><b>${esc(c.joinCode)}</b><button class="btn sm" data-action="copyJoinCode" data-code="${esc(c.joinCode)}">Copy</button></div>` : ''}
    <div class="btn-row"><button class="btn" data-action="syncNow">${icon('sync', 16)} Sync now</button><button class="btn ghost" data-action="syncSignOut">Sign out</button></div>`;
}

// ---------- Settings ----------
export function settingsView() {
  const s = S.settings();
  const members = [...s.members, ''];
  return `<div class="grid cols">
  <section class="card">
    <h2>Household</h2>
    <form class="form" data-form="settings">
      <label class="field"><span>Household name</span><input name="householdName" value="${esc(s.householdName)}" required></label>
      <div class="field"><span>People and their colours</span>${members.map((m, i) => {
        const col = s.memberColors[m] || S.PERSON_COLOURS[i % S.PERSON_COLOURS.length];
        return `<div class="person-row">
          <input name="member${i}" value="${esc(m)}" placeholder="${i < 2 ? 'Name' : 'Add another person (optional)'}" aria-label="Person ${i + 1}">
          <div class="swatches" role="radiogroup" aria-label="Colour for person ${i + 1}">${S.PERSON_COLOURS.map(c => `<label><input type="radio" name="color${i}" value="${c}" ${c === col ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
        </div>`;
      }).join('')}</div>
      <label class="field"><span>Who uses this phone / laptop? <small class="muted">— payments added here are tagged with this person</small></span><select name="currentMember">${s.members.map(m => `<option ${m === s.currentMember ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <div class="row2">
        <label class="field"><span>Month starts on day</span><input name="monthStartDay" type="number" min="1" max="28" value="${s.monthStartDay}"><small class="muted">Set to payday (e.g. 28) to budget payday-to-payday</small></label>
        <label class="field"><span>Currency</span><select name="currency">${Object.keys(S.CURRENCIES).map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span>Appearance</span><div class="seg">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <div class="form-actions"><button class="btn primary" type="submit">Save settings</button></div>
    </form>
  </section>
  <section class="card">
    ${syncCard()}
    <h2 class="mt">Your data</h2>
    <div class="btn-col">
      <button class="btn" data-action="exportBackup">${icon('download', 18)} Back up (download file)</button>
      <label class="btn">${icon('upload', 18)} Restore from backup<input type="file" accept=".json,application/json" hidden data-change="restoreBackup"></label>
      <button class="btn" data-action="exportCsv">${icon('download', 18)} Export payments to CSV / Excel</button>
      <button class="btn" data-action="importCsv">${icon('upload', 18)} Import a bank statement (CSV)</button>
      <button class="btn" data-action="loadDemo">✨ Load demo data</button>
      <button class="btn danger" data-action="wipeAll">${icon('x', 18)} Erase everything on this device</button>
    </div>
    <p class="small muted mt">C.A.S.H — Control All Spending Habits · v1.0</p>
  </section></div>`;
}
