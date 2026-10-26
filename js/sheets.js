// Add/edit forms shown in bottom sheets, plus what happens when they're saved.
import * as S from './store.js';
import { esc, money, todayISO, parseAmount, round2, currencySymbol, FREQS, sum, perMonth, periodOf, $, $$ } from './util.js';
import { openSheet, closeSheet, sheetHead, toast, icon, view } from './ui.js';
import { guessCategory, learn } from './categorise.js';
import { expectedIn } from './calc.js';
import { potSaved } from './views.js';

// ---------- small form builders ----------
export function catOptions(type, selected, { blank = '' } = {}) {
  const cats = S.list('categories').filter(c => [type, 'transfer'].includes(c.type || 'out'));
  return (blank ? `<option value="">${esc(blank)}</option>` : '') +
    cats.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
}

function catChips(type, selected) {
  return S.list('categories').filter(c => [type, 'transfer'].includes(c.type || 'out')).map(c =>
    `<label class="chip"><input type="radio" name="categoryId" value="${c.id}" ${c.id === selected ? 'checked' : ''}><span>${c.icon} ${esc(c.name)}</span></label>`).join('');
}

function memberSeg(name, selected, extra = []) {
  return `<div class="seg">${[...S.settings().members, ...extra].map(m =>
    `<label><input type="radio" name="${name}" value="${esc(m)}" ${m === selected ? 'checked' : ''}><span><i class="dot" style="background:${S.memberColor(m)}"></i>${esc(m)}</span></label>`).join('')}</div>`;
}

const amountField = (value, autofocus) => `<div class="amount-field"><span>${esc(currencySymbol())}</span>
  <input name="amount" inputmode="decimal" placeholder="0.00" value="${value ? round2(value).toFixed(2) : ''}" required autocomplete="off" aria-label="Amount" ${autofocus ? 'autofocus' : ''}></div>`;

function freqFields(item) {
  const f = item.frequency || 'monthly';
  return `<div class="row2">
    <label class="field"><span>How often</span><select name="frequency" data-freq-select>${Object.entries(FREQS).map(([v, l]) => `<option value="${v}" ${v === f ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field if-day"><span>Day of month</span><input name="dueDay" type="number" min="1" max="31" value="${item.dueDay || 1}"></label>
    <label class="field if-anchor"><span>A payment date</span><input name="anchorDate" type="date" value="${item.anchorDate || todayISO()}"></label>
  </div>`;
}
function wireFreq(sheet) {
  const sel = $('[data-freq-select]', sheet), form = sel.form;
  const set = () => { form.dataset.freq = sel.value; };
  sel.addEventListener('change', set); set();
}

const actionsRow = (isNew, delAction, id, label = 'Save') => `<div class="form-actions">
  ${!isNew ? `<button type="button" class="btn ghost danger" data-action="${delAction}" data-id="${id}">Delete</button>` : ''}
  <button class="btn primary" type="submit">${isNew ? 'Add' : label}</button></div>`;

// ---------- Add menu ----------
export function addMenu() {
  openSheet(`${sheetHead('Add to C.A.S.H', 'How would you like to add it?')}
  <div class="add-grid">
    <button class="add-tile" data-action="newTx" data-type="out"><span class="add-ic">${icon('pen')}</span><b>Expense</b><small>Spent while out</small></button>
    <button class="add-tile" data-action="scan" data-mode="receipt"><span class="add-ic gold">${icon('camera')}</span><b>Scan receipt</b><small>Photo → split by category</small></button>
    <button class="add-tile" data-action="scan" data-mode="screenshot"><span class="add-ic gold">${icon('phone')}</span><b>Screenshot</b><small>From your banking app</small></button>
    <button class="add-tile" data-action="importCsv"><span class="add-ic">${icon('upload')}</span><b>Bank CSV</b><small>Import a statement</small></button>
    <button class="add-tile" data-action="newTx" data-type="in"><span class="add-ic in">${icon('coins')}</span><b>Money in</b><small>Wages, refunds…</small></button>
    <button class="add-tile" data-action="newBill"><span class="add-ic">${icon('bill')}</span><b>Bill</b><small>Regular payment</small></button>
  </div>`);
}

// ---------- Transaction ----------
export function txForm(t, type = 'out') {
  const isNew = !t;
  t = t || { type, date: todayISO(), member: S.settings().currentMember, categoryId: type === 'in' ? 'wages' : '' };
  const recent = [...new Set(S.list('transactions').filter(x => x.type === t.type).slice(-60).map(x => x.desc))].reverse().slice(0, 30);
  const splits = t.splits?.length > 1 ? `<div class="field"><span>Split across categories</span><div class="split-summary">${t.splits.reduce((acc, s) => { const k = s.categoryId; const f = acc.find(a => a.k === k); f ? f.v += +s.amount : acc.push({ k, v: +s.amount }); return acc; }, []).map(a => `<span>${S.cat(a.k).icon} ${esc(S.cat(a.k).name)} ${money(a.v)}</span>`).join('')}</div><small class="muted">Changing the amount or category will remove the split.</small></div>` : '';
  openSheet(`${sheetHead(isNew ? (t.type === 'in' ? 'Money in' : 'New expense') : 'Edit payment')}
  <form class="form" data-form="tx">
    <input type="hidden" name="id" value="${t.id || ''}"><input type="hidden" name="type" value="${t.type}">
    ${amountField(t.amount, isNew)}
    <label class="field"><span>${t.type === 'in' ? 'From' : 'What / where'}</span><input name="desc" value="${esc(t.desc || '')}" placeholder="${t.type === 'in' ? 'e.g. Salary' : 'e.g. Woolies, school excursion'}" required list="desc-list" autocomplete="off">
      <datalist id="desc-list">${recent.map(d => `<option value="${esc(d)}">`).join('')}</datalist></label>
    <div class="field"><span>Category</span><div class="chips">${catChips(t.type, t.categoryId)}</div></div>
    ${splits}
    <div class="row2"><label class="field"><span>Date</span><input type="date" name="date" value="${t.date}" required></label>
      <div class="field"><span>Who</span>${memberSeg('member', t.member, ['Joint'])}</div></div>
    <label class="field"><span>Note</span><input name="note" value="${esc(t.note || '')}" placeholder="Optional"></label>
    ${actionsRow(isNew, 'deleteTx', t.id)}
  </form>`, {
    onMount: sheet => {
      let picked = !!t.categoryId;
      $$('[name=categoryId]', sheet).forEach(r => r.addEventListener('change', () => { picked = true; }));
      $('[name=desc]', sheet).addEventListener('change', e => {
        if (picked) return;
        const id = guessCategory(e.target.value, t.type);
        const r = $(`[name=categoryId][value="${id}"]`, sheet);
        if (r) { r.checked = true; r.closest('.chip').scrollIntoView({ block: 'nearest' }); }
      });
    },
  });
}

function saveTx(d) {
  const amount = round2(parseAmount(d.amount));
  if (!(amount > 0)) return toast('Enter an amount');
  const old = d.id ? S.byId('transactions', d.id) : null;
  const tx = {
    id: d.id || undefined, type: d.type, amount, desc: d.desc.trim(), date: d.date,
    categoryId: d.categoryId || guessCategory(d.desc, d.type), member: d.member || '', note: d.note.trim(),
  };
  if (!old) tx.source = 'manual';
  if (old?.splits && (old.amount !== amount || (d.categoryId && d.categoryId !== old.categoryId))) tx.splits = null;
  if (d.categoryId) learn(tx.desc, tx.categoryId);
  S.upsert('transactions', tx);
  closeSheet();
  toast(old ? 'Saved' : `Added ${money(amount)} · ${S.cat(tx.categoryId).name}`);
}

function deleteTx(id) {
  const t = S.byId('transactions', id);
  if (!t) return;
  // un-tick any bill/wage this payment was ticking off
  for (const [coll, key] of [['bills', 'paid'], ['incomes', 'received']]) {
    for (const b of S.list(coll)) for (const [iso, tid] of Object.entries(b[key] || {})) if (tid === id) { delete b[key][iso]; b.updatedAt = Date.now(); }
  }
  S.remove('transactions', id);
  closeSheet();
  toast('Payment deleted', { label: 'Undo', fn: () => { t.deleted = false; S.upsert('transactions', t); } });
}

// ---------- Bills ----------
export function billForm(b) {
  const isNew = !b;
  b = b || { frequency: 'monthly', dueDay: 1, method: 'Direct Debit', payer: 'Joint', categoryId: 'housing', active: true };
  openSheet(`${sheetHead(isNew ? 'New bill' : 'Edit bill', 'Anything that comes out regularly')}
  <form class="form" data-form="bill">
    <input type="hidden" name="id" value="${b.id || ''}">
    ${amountField(b.amount, isNew)}
    <label class="field"><span>Bill name</span><input name="name" value="${esc(b.name || '')}" placeholder="e.g. Council rates, AGL, Telstra, Netflix" required></label>
    <label class="field"><span>Category</span><select name="categoryId">${catOptions('out', b.categoryId)}</select></label>
    ${freqFields(b)}
    <div class="row2">
      <label class="field"><span>Paid by</span><select name="method">${['Direct Debit', 'BPAY', 'Card', 'PayID / transfer', 'Cash / manual'].map(m => `<option ${m === b.method ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="field"><span>Whose account</span><select name="payer">${[...S.settings().members, 'Joint'].map(m => `<option ${m === b.payer ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Name on bank statement <small class="muted">(optional, helps match imports)</small></span><input name="keywords" value="${esc(b.keywords || '')}" placeholder="e.g. AGL SALES, CITY OF BRISBANE"></label>
    <label class="field"><span>Notes</span><input name="notes" value="${esc(b.notes || '')}" placeholder="Account number, renewal date, contract end…"></label>
    <label class="check"><input type="checkbox" name="active" ${b.active !== false ? 'checked' : ''}> Active</label>
    ${actionsRow(isNew, 'deleteBill', b.id)}
  </form>`, { onMount: wireFreq });
}

function saveBill(d) {
  const amount = round2(parseAmount(d.amount));
  if (!(amount > 0)) return toast('Enter an amount');
  S.upsert('bills', {
    id: d.id || undefined, name: d.name.trim(), amount, categoryId: d.categoryId, frequency: d.frequency,
    dueDay: +d.dueDay || 1, anchorDate: d.anchorDate, method: d.method, payer: d.payer,
    keywords: d.keywords.trim(), notes: d.notes.trim(), active: d.active === 'on',
  });
  closeSheet();
  toast(d.id ? 'Bill saved' : 'Bill added');
}

const incomeCategory = i => { const g = guessCategory(i.name + ' ' + (i.keywords || ''), 'in'); return g === 'otherin' ? 'wages' : g; };

// Ticking a bill as paid records the payment so it shows in spending.
function toggleScheduled(coll, key, id, date) {
  const item = S.byId(coll, id);
  const tid = item[key]?.[date];
  if (tid) {
    const t = S.byId('transactions', tid);
    if (t && (t.source === 'bill' || t.source === 'income')) S.remove('transactions', tid, { silent: true });
    delete item[key][date];
    S.upsert(coll, item);
    toast(coll === 'bills' ? 'Marked as not paid' : 'Marked as not received');
    return;
  }
  const isBill = coll === 'bills';
  const tx = S.upsert('transactions', {
    type: isBill ? 'out' : 'in', amount: item.amount, desc: item.name, date: date > todayISO() ? todayISO() : date,
    categoryId: isBill ? item.categoryId : incomeCategory(item), member: isBill ? item.payer : item.member,
    source: isBill ? 'bill' : 'income', [isBill ? 'billId' : 'incomeId']: item.id,
  }, { silent: true });
  item[key] = { ...(item[key] || {}), [date]: tx.id };
  S.upsert(coll, item);
  toast(isBill ? `${item.name} paid — added to spending` : `${item.name} received`);
}

// ---------- Wages / income ----------
export function incomeForm(i) {
  const isNew = !i;
  i = i || { frequency: 'fortnightly', dueDay: 15, anchorDate: todayISO(), member: S.settings().currentMember, active: true };
  openSheet(`${sheetHead(isNew ? 'New wage / income' : 'Edit income', 'Use take-home pay (after tax)')}
  <form class="form" data-form="income">
    <input type="hidden" name="id" value="${i.id || ''}">
    ${amountField(i.amount, isNew)}
    <label class="field"><span>Name</span><input name="name" value="${esc(i.name || '')}" placeholder="e.g. Wages, Family Tax Benefit" required></label>
    <div class="field"><span>Whose</span>${memberSeg('member', i.member, ['Joint'])}</div>
    ${freqFields(i)}
    <label class="field"><span>Name on bank statement <small class="muted">(optional)</small></span><input name="keywords" value="${esc(i.keywords || '')}" placeholder="e.g. ACME PTY LTD SALARY"></label>
    <label class="check"><input type="checkbox" name="active" ${i.active !== false ? 'checked' : ''}> Active</label>
    ${actionsRow(isNew, 'deleteIncome', i.id)}
  </form>`, { onMount: wireFreq });
}

function saveIncome(d) {
  const amount = round2(parseAmount(d.amount));
  if (!(amount > 0)) return toast('Enter an amount');
  S.upsert('incomes', {
    id: d.id || undefined, name: d.name.trim(), amount, member: d.member, frequency: d.frequency,
    dueDay: +d.dueDay || 1, anchorDate: d.anchorDate, keywords: d.keywords.trim(), active: d.active === 'on',
  });
  closeSheet();
  toast(d.id ? 'Income saved' : 'Income added');
}

// ---------- Categories & budget ----------
export function categoryForm(c) {
  const isNew = !c;
  c = c || { icon: '🏷️', group: 'lifestyle', budget: 0, type: 'out' };
  openSheet(`${sheetHead(isNew ? 'New category' : 'Edit category')}
  <form class="form" data-form="category">
    <input type="hidden" name="id" value="${c.id || ''}">
    <div class="row-icon"><label class="field"><span>Icon</span><input name="icon" value="${esc(c.icon)}" maxlength="4" class="emoji-input"></label>
      <label class="field grow"><span>Name</span><input name="name" value="${esc(c.name || '')}" required placeholder="e.g. Football club"></label></div>
    <div class="row2">
      <label class="field"><span>Monthly budget</span><input name="budget" inputmode="decimal" value="${c.budget || ''}" placeholder="0"></label>
      <label class="field"><span>Group</span><select name="group">${S.GROUPS.map(g => `<option value="${g.id}" ${g.id === c.group ? 'selected' : ''}>${g.name}</option>`).join('')}</select></label>
    </div>
    ${actionsRow(isNew, 'deleteCategory', c.id)}
  </form>`);
}

function saveCategory(d) {
  S.upsert('categories', {
    id: d.id || undefined, name: d.name.trim(), icon: d.icon.trim() || '🏷️',
    budget: round2(parseAmount(d.budget)), group: d.group, type: d.id ? S.byId('categories', d.id).type : 'out',
  });
  closeSheet();
  toast('Category saved');
}

function deleteCategory(id) {
  if (id === 'other') return toast('“Other” is needed as a catch-all');
  if (!confirm('Delete this category? Its payments will show under Other.')) return;
  S.remove('categories', id);
  closeSheet();
}

export function budgetHelper() {
  const income = Math.round(expectedIn(periodOf(view.period)) || sum(S.list('incomes'), i => perMonth(i.amount, i.frequency)));
  openSheet(`${sheetHead('50/30/20 budget helper', 'A simple rule: needs, wants, savings')}
  <form class="form" data-form="budgetHelper">
    <label class="field"><span>Monthly take-home pay (all of you)</span><input name="income" inputmode="decimal" value="${income || ''}" required></label>
    <div class="row3">${S.GROUPS.slice(0, 3).map(g => `<label class="field"><span><i class="dot" style="background:${g.color}"></i>${g.name} %</span><input name="pct_${g.id}" type="number" min="0" max="100" value="${g.target}"></label>`).join('')}</div>
    <div class="notice" id="helper-preview"></div>
    <p class="small muted">Each group's budget is shared across its categories in the same proportions you have now. You can fine-tune any category afterwards.</p>
    <div class="form-actions"><button class="btn primary" type="submit">Apply to my budget</button></div>
  </form>`, {
    onMount: sheet => {
      const f = $('form', sheet);
      const upd = () => {
        const inc = parseAmount(f.income.value);
        const pcts = S.GROUPS.slice(0, 3).map(g => +f['pct_' + g.id].value || 0);
        const tot = pcts.reduce((a, b) => a + b, 0);
        $('#helper-preview', sheet).innerHTML = S.GROUPS.slice(0, 3).map((g, i) => `${g.name}: <b>${money((inc * pcts[i]) / 100, { whole: true })}</b>`).join(' · ') +
          (tot !== 100 ? `<br><span class="status warn">● Adds up to ${tot}%, not 100%</span>` : '');
      };
      f.addEventListener('input', upd); upd();
    },
  });
}

function applyBudgetHelper(d) {
  const inc = parseAmount(d.income);
  for (const g of S.GROUPS.slice(0, 3)) {
    const target = (inc * (+d['pct_' + g.id] || 0)) / 100;
    const cats = S.list('categories').filter(c => c.group === g.id && c.type !== 'in');
    const cur = sum(cats, c => c.budget);
    for (const c of cats) {
      const share = cur ? c.budget / cur : 1 / cats.length;
      c.budget = Math.round((target * share) / 5) * 5;
      c.updatedAt = Date.now();
    }
  }
  S.save();
  closeSheet();
  toast('Budget updated');
}

// ---------- Savings pots ----------
export function potForm(p) {
  const isNew = !p;
  p = p || { icon: '🐷' };
  openSheet(`${sheetHead(isNew ? 'New savings pot' : 'Edit pot')}
  <form class="form" data-form="pot">
    <input type="hidden" name="id" value="${p.id || ''}">
    <div class="row-icon"><label class="field"><span>Icon</span><input name="icon" value="${esc(p.icon)}" maxlength="4" class="emoji-input"></label>
      <label class="field grow"><span>Saving for</span><input name="name" value="${esc(p.name || '')}" required placeholder="e.g. Holiday 2027"></label></div>
    <div class="row2">
      <label class="field"><span>Goal</span><input name="goal" inputmode="decimal" value="${p.goal || ''}" placeholder="Optional"></label>
      <label class="field"><span>By when</span><input name="targetDate" type="date" value="${p.targetDate || ''}"></label>
    </div>
    ${isNew ? `<label class="field"><span>Already saved</span><input name="start" inputmode="decimal" placeholder="0"></label>` : ''}
    ${actionsRow(isNew, 'deletePot', p.id)}
  </form>`);
}

function savePot(d) {
  const pot = { id: d.id || undefined, name: d.name.trim(), icon: d.icon.trim() || '🐷', goal: round2(parseAmount(d.goal)), targetDate: d.targetDate };
  if (!d.id) {
    pot.entries = [];
    const start = round2(parseAmount(d.start));
    if (start) pot.entries.push({ id: S.uid(), date: todayISO(), amount: start, note: 'Starting balance' });
  }
  S.upsert('pots', pot);
  closeSheet();
  toast('Pot saved');
}

export function potEntryForm(p, dir) {
  const isIn = dir === 'in';
  openSheet(`${sheetHead(isIn ? `Add to ${p.name}` : `Take from ${p.name}`, `Currently ${money(potSaved(p))}`)}
  <form class="form" data-form="potEntry">
    <input type="hidden" name="id" value="${p.id}"><input type="hidden" name="dir" value="${dir}">
    ${amountField(0, true)}
    <div class="row2"><label class="field"><span>Date</span><input type="date" name="date" value="${todayISO()}"></label>
      <label class="field"><span>Note</span><input name="note" placeholder="Optional"></label></div>
    <label class="check"><input type="checkbox" name="record" checked> ${isIn ? "Count it as money out of this month's budget (Savings)" : 'Count it as money back in this month'}</label>
    <div class="form-actions"><button class="btn primary" type="submit">${isIn ? 'Add money' : 'Take out'}</button></div>
  </form>`);
}

function savePotEntry(d) {
  const p = S.byId('pots', d.id);
  const amount = round2(parseAmount(d.amount));
  if (!(amount > 0)) return toast('Enter an amount');
  const isIn = d.dir === 'in';
  const entry = { id: S.uid(), date: d.date, amount: isIn ? amount : -amount, note: d.note.trim() };
  if (d.record === 'on') {
    const tx = S.upsert('transactions', {
      type: isIn ? 'out' : 'in', amount, date: d.date, desc: `${isIn ? 'To' : 'From'} ${p.name} pot`,
      categoryId: isIn ? 'savings' : 'otherin', member: S.settings().currentMember, source: 'pot',
    }, { silent: true });
    entry.txId = tx.id;
  }
  p.entries = [...(p.entries || []), entry];
  S.upsert('pots', p);
  closeSheet();
  toast(isIn ? `${money(amount)} added to ${p.name}` : `${money(amount)} taken from ${p.name}`);
}

// ---------- Accounts (offset, credit card…) ----------
const KIND_LABELS = { offset: 'Offset account', credit: 'Credit card', savings: 'Savings account', everyday: 'Everyday account' };

export function accountForm(a) {
  const isNew = !a;
  a = a || { kind: 'offset' };
  openSheet(`${sheetHead(isNew ? 'New account' : 'Edit account', 'Track a balance you check regularly')}
  <form class="form" data-form="account" data-kind="${a.kind}">
    <input type="hidden" name="id" value="${a.id || ''}">
    <label class="field"><span>Name</span><input name="name" value="${esc(a.name || '')}" required placeholder="e.g. NAB Offset, NAB Qantas card"></label>
    <label class="field"><span>Type</span><select name="kind" data-kind-select>${Object.entries(KIND_LABELS).map(([v, l]) => `<option value="${v}" ${v === a.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field if-credit"><span>Card limit</span><input name="limit" inputmode="decimal" value="${a.limit ?? ''}" placeholder="e.g. 10000"></label>
    <label class="field if-offset"><span>Home-loan interest rate (%)</span><input name="rate" inputmode="decimal" value="${a.rate ?? ''}" placeholder="e.g. 6.19"><small class="muted">Used to show how much interest your offset is saving</small></label>
    <label class="field"><span>Account number ends in <small class="muted">(optional — last 4 digits only)</small></span><input name="last4" inputmode="numeric" maxlength="4" value="${esc(a.last4 || '')}" placeholder="1234"></label>
    ${isNew ? `<label class="field"><span>Current balance <small class="muted">(for a card: the amount owed)</small></span><input name="balance" inputmode="decimal" placeholder="0.00"></label>` : ''}
    ${actionsRow(isNew, 'deleteAccount', a.id)}
  </form>`, {
    onMount: sheet => {
      const sel = $('[data-kind-select]', sheet);
      sel.addEventListener('change', () => { sel.form.dataset.kind = sel.value; });
    },
  });
}

// Record a balance for today (one entry per day; a second update the same day replaces it).
export function recordBalance(a, balance, date = todayISO(), { silent = false } = {}) {
  const hist = (a.history || []).filter(h => h.date !== date);
  hist.push({ date, balance, by: S.settings().currentMember });
  hist.sort((x, y) => x.date.localeCompare(y.date));
  const latest = hist[hist.length - 1];
  return S.upsert('accounts', { ...a, history: hist.slice(-400), balance: latest.balance }, { silent });
}

function saveAccount(d) {
  const old = d.id ? S.byId('accounts', d.id) : null;
  const acc = {
    ...(old || { history: [], balance: null }), id: d.id || undefined, name: d.name.trim(), kind: d.kind,
    limit: d.limit ? round2(parseAmount(d.limit)) : null, rate: d.rate ? parseFloat(d.rate) : null,
    last4: (d.last4 || '').replace(/\D/g, '').slice(-4),
  };
  const saved = S.upsert('accounts', acc, { silent: true });
  if (!old && d.balance !== '') {
    const v = round2(parseAmount(d.balance));
    recordBalance(saved, d.kind === 'credit' ? Math.abs(v) : v, todayISO(), { silent: true });
  }
  S.save();
  closeSheet();
  toast('Account saved');
}

export function balanceForm(a) {
  const credit = a.kind === 'credit';
  openSheet(`${sheetHead(`Update ${a.name}`, credit ? 'How much is owed on the card right now?' : 'What is the balance right now?')}
  <form class="form" data-form="balance">
    <input type="hidden" name="id" value="${a.id}">
    ${amountField(a.balance ?? 0, true)}
    <label class="field"><span>Date</span><input type="date" name="date" value="${todayISO()}" max="${todayISO()}"></label>
    <p class="small muted">Tip: copy it from the NAB app, or import a NAB CSV for this account and C.A.S.H reads the latest balance for you.</p>
    <div class="form-actions"><button class="btn primary" type="submit">Save balance</button></div>
  </form>`);
}

function saveBalance(d) {
  const a = S.byId('accounts', d.id);
  const v = round2(parseAmount(d.amount));
  recordBalance(a, a.kind === 'credit' ? Math.abs(v) : v, d.date || todayISO());
  closeSheet();
  toast(`${a.name}: ${money(a.kind === 'credit' ? Math.abs(v) : v)}`);
}

// ---------- First run ----------
export function welcome() {
  openSheet(`<div class="welcome">
    <img src="icons/logo.svg" alt="" class="welcome-logo">
    <h2>Welcome to C.A.S.H</h2>
    <p class="muted">Control All Spending Habits — see every bill, wage and penny in one place.</p>
  </div>
  <form class="form" data-form="welcome">
    <label class="field"><span>Household name</span><input name="householdName" value="The ${esc('Family')}" required></label>
    <div class="row2"><label class="field"><span>Your name</span><input name="me" required placeholder="e.g. James"></label>
      <label class="field"><span>Partner's name</span><input name="partner" placeholder="Optional"></label></div>
    <label class="field"><span>Budget months start on day</span><input name="monthStartDay" type="number" min="1" max="28" value="1"><small class="muted">Tip: use your payday (e.g. 28) to budget payday-to-payday</small></label>
    <div class="field"><span>Start with</span><div class="seg">
      <label><input type="radio" name="start" value="template" checked><span>Our budget template</span></label>
      <label><input type="radio" name="start" value="demo"><span>Demo data to explore</span></label></div></div>
    <p class="small muted">Partner already set up C.A.S.H? Tap Let's go, then Settings → Family sync → Join household.</p>
    <div class="form-actions"><button class="btn primary" type="submit">Let's go</button></div>
  </form>`);
}

export const forms = {
  tx: saveTx, bill: saveBill, income: saveIncome, category: saveCategory,
  budgetHelper: applyBudgetHelper, pot: savePot, potEntry: savePotEntry,
  account: saveAccount, balance: saveBalance,
};

export const actions = {
  openAdd: () => addMenu(),
  newTx: el => txForm(null, el.dataset.type),
  editTx: el => { const t = S.byId('transactions', el.dataset.id); if (t) txForm(t); },
  deleteTx: el => deleteTx(el.dataset.id),
  newBill: () => billForm(),
  editBill: el => billForm(S.byId('bills', el.dataset.id)),
  deleteBill: el => { if (confirm('Delete this bill? Past payments stay in your history.')) { S.remove('bills', el.dataset.id); closeSheet(); } },
  toggleBill: el => toggleScheduled('bills', 'paid', el.dataset.id, el.dataset.date),
  newIncome: () => incomeForm(),
  editIncome: el => incomeForm(S.byId('incomes', el.dataset.id)),
  deleteIncome: el => { if (confirm('Delete this income?')) { S.remove('incomes', el.dataset.id); closeSheet(); } },
  toggleIncome: el => toggleScheduled('incomes', 'received', el.dataset.id, el.dataset.date),
  newCategory: () => categoryForm(),
  editCategory: el => categoryForm(S.byId('categories', el.dataset.id)),
  deleteCategory: el => deleteCategory(el.dataset.id),
  budgetHelper: () => budgetHelper(),
  newPot: () => potForm(),
  editPot: el => potForm(S.byId('pots', el.dataset.id)),
  deletePot: el => { if (confirm('Delete this pot and its history?')) { S.remove('pots', el.dataset.id); closeSheet(); } },
  potIn: el => potEntryForm(S.byId('pots', el.dataset.id), 'in'),
  potOut: el => potEntryForm(S.byId('pots', el.dataset.id), 'out'),
  newAccount: () => accountForm(),
  editAccount: el => accountForm(S.byId('accounts', el.dataset.id)),
  deleteAccount: el => { if (confirm('Delete this account and its balance history? Payments stay.')) { S.remove('accounts', el.dataset.id); closeSheet(); } },
  updateBalance: el => balanceForm(S.byId('accounts', el.dataset.id)),
};


