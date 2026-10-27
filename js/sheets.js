// Add/edit forms shown in bottom sheets, plus what happens when they're saved.
import * as S from './store.js';
import { esc, money, todayISO, parseAmount, round2, currencySymbol, FREQS, sum, perMonth, periodOf, fmtDate, $, $$ } from './util.js';
import { openSheet, closeSheet, sheetHead, toast, icon, view, confetti, buzz } from './ui.js';
import { guessCategory, learn, hasText, similarText, addWordRule, removeRule, wordRules, learnedRules } from './categorise.js';
import { expectedIn, incomeAmount, relinkIncomes } from './calc.js';
import { potSaved, potPct, MILESTONES } from './views.js';

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
// Things you add by hand again and again ("Coffee $5.50"), most frequent first.
function usualSpends() {
  const since = Date.now() - 90 * 864e5, seen = {};
  for (const t of S.list('transactions')) {
    if (t.source !== 'manual' || t.type !== 'out' || t.splits?.length > 1 || new Date(t.date) < since) continue;
    const k = `${t.desc.trim().toLowerCase()}|${t.amount}`;
    (seen[k] ||= { desc: t.desc.trim(), amount: t.amount, categoryId: t.categoryId, n: 0 }).n++;
  }
  return Object.values(seen).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6);
}

function repeatSpend(el) {
  const tx = S.upsert('transactions', {
    type: 'out', amount: +el.dataset.amount, desc: el.dataset.desc, date: todayISO(), categoryId: el.dataset.cat,
    member: S.settings().currentMember, source: 'manual',
  });
  closeSheet();
  buzz(20);
  toast(`Added ${el.dataset.desc} ${money(tx.amount)}`, { label: 'Undo', fn: () => S.remove('transactions', tx.id) });
}

export function addMenu() {
  const usual = usualSpends();
  openSheet(`${sheetHead('Add to C.A.S.H', 'How would you like to add it?')}
  ${usual.length ? `<div class="field"><span>One tap — add again today</span><div class="chips repeat">${usual.map(u =>
    `<button class="chip" data-action="repeatSpend" data-desc="${esc(u.desc)}" data-amount="${u.amount}" data-cat="${u.categoryId}">${S.cat(u.categoryId).icon} ${esc(u.desc)} <b>${money(u.amount)}</b></button>`).join('')}</div></div>` : ''}
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
  // Moved a payment to another category? Offer to move the ones like it too.
  if (old && d.categoryId && d.categoryId !== old.categoryId) {
    const text = similarText(tx.desc);
    if (text && similarPayments(text, tx.categoryId, tx.id).length) setTimeout(() => similarSheet({ text, categoryId: tx.categoryId, exceptId: tx.id }), 300);
  }
}

// ---------- Move similar payments together (and remember it) ----------
function similarPayments(text, categoryId, exceptId) {
  const type = S.cat(categoryId).type || 'out';
  return S.list('transactions').filter(t => t.id !== exceptId && !(t.splits?.length > 1) && t.categoryId !== categoryId &&
    (type === 'transfer' || t.type === type) && hasText(text, t.desc))
    .sort((a, b) => b.date.localeCompare(a.date));
}

const allCatOptions = (selected, type) => S.list('categories').filter(c => !type || (c.type || 'out') === type || c.type === 'transfer')
  .map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');

function similarList(text, categoryId, exceptId) {
  if (!text.trim()) return '<p class="small muted">Type part of the name, e.g. BWS.</p>';
  if (!categoryId) return '<p class="small muted">Pick a category.</p>';
  const list = similarPayments(text, categoryId, exceptId);
  if (!list.length) return `<p class="small muted">No other payments with “${esc(text)}” in the name need moving.</p>`;
  return `<div class="btn-row"><span class="small"><b>${list.length}</b> payment${list.length === 1 ? '' : 's'} · ${money(sum(list, t => t.amount))}</span>
      <button type="button" class="btn sm" data-action="reviewAll" data-on="1">Tick all</button><button type="button" class="btn sm" data-action="reviewAll" data-on="0">Untick all</button></div>
    <div class="imp-list">${list.map(t => `<label class="imp-row">
      <input type="checkbox" name="sel" value="${t.id}" checked>
      <div><b>${esc(t.desc)}</b><div class="meta">${fmtDate(t.date, { day: 'numeric', month: 'short', year: '2-digit' })} · now ${S.cat(t.categoryId).icon} ${esc(S.cat(t.categoryId).name)}</div></div>
      <b class="tx-amt ${t.type}">${money(t.amount)}</b></label>`).join('')}</div>`;
}

export function similarSheet({ text = '', categoryId = '', exceptId = '', title } = {}) {
  const c = categoryId && S.cat(categoryId);
  openSheet(`${sheetHead(title || `Move other “${text}” payments too?`, c ? `To ${c.icon} ${c.name}` : 'Pick the words and the category')}
  <form class="form" data-form="bulkMove">
    <input type="hidden" name="exceptId" value="${esc(exceptId)}">
    <div class="row2">
      <label class="field"><span>Name contains</span><input name="text" value="${esc(text)}" placeholder="e.g. BWS" autocomplete="off"></label>
      <label class="field"><span>Category</span><select name="categoryId"><option value="">Choose…</option>${allCatOptions(categoryId)}</select></label>
    </div>
    <div class="similar-list">${similarList(text, categoryId, exceptId)}</div>
    <label class="check"><input type="checkbox" name="always" checked> Always put payments containing this into that category (new imports too)</label>
    <div class="form-actions"><button class="btn primary" type="submit">Move &amp; save</button><button class="btn ghost" type="button" data-action="closeSheet">Not now</button></div>
  </form>`, {
    onMount: sheet => {
      const f = $('form', sheet);
      let timer;
      const redraw = () => { clearTimeout(timer); timer = setTimeout(() => { $('.similar-list', sheet).innerHTML = similarList(f.text.value, f.categoryId.value, f.exceptId.value); }, 150); };
      f.text.addEventListener('input', redraw);
      f.categoryId.addEventListener('change', redraw);
    },
  });
}

function saveBulkMove(d, f) {
  if (!d.categoryId) return toast('Pick a category');
  const ids = $$('[name=sel]:checked', f).map(x => x.value);
  if (d.always === 'on' && d.text.trim()) addWordRule(d.text, d.categoryId);
  const before = ids.map(id => [id, S.byId('transactions', id)?.categoryId]);
  for (const id of ids) {
    const t = S.byId('transactions', id);
    if (!t) continue;
    t.categoryId = d.categoryId; t.updatedAt = Date.now();
  }
  S.save();
  closeSheet();
  const c = S.cat(d.categoryId);
  const msg = ids.length ? `Moved ${ids.length} payment${ids.length === 1 ? '' : 's'} to ${c.icon} ${c.name}` : `Rule saved: “${d.text.trim()}” → ${c.name}`;
  toast(msg, ids.length ? { label: 'Undo', fn: () => {
    for (const [id, cat] of before) { const t = S.byId('transactions', id); if (t && cat) { t.categoryId = cat; t.updatedAt = Date.now(); } }
    S.save();
  } } : undefined);
}

// ---------- Category rules (Settings) ----------
export function rulesSheet() {
  const mine = wordRules(), learned = learnedRules();
  const row = r => `<div class="rule-row"><span><b>“${esc(r.text)}”</b> → ${S.cat(r.categoryId).icon} ${esc(S.cat(r.categoryId).name)}</span>
    <button class="icon-btn sm" data-action="deleteRule" data-key="${esc(r.key)}" aria-label="Delete rule">${icon('x', 16)}</button></div>`;
  openSheet(`${sheetHead('Category rules', 'How C.A.S.H sorts payments automatically')}
    <div class="btn-row"><button class="btn primary" data-action="newRule">${icon('plus', 18)} New rule</button></div>
    <div class="section-title"><span>Your rules</span></div>
    <div class="card list">${mine.map(row).join('') || '<p class="small muted pad">None yet. Add one, e.g. “BWS” → Alcohol. It moves past payments too.</p>'}</div>
    ${learned.length ? `<div class="section-title"><span>Learned from your changes</span></div>
    <p class="small muted">When you change a payment's category, C.A.S.H remembers that exact name.</p>
    <div class="card list">${learned.map(row).join('')}</div>` : ''}`);
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
    <label class="check"><input type="checkbox" name="varies" ${i.varies ? 'checked' : ''}> Amount varies — expect the average of my last 3 pays</label>
    <label class="check"><input type="checkbox" name="active" ${i.active !== false ? 'checked' : ''}> Active</label>
    ${actionsRow(isNew, 'deleteIncome', i.id)}
  </form>`, { onMount: wireFreq });
}

function saveIncome(d) {
  const amount = round2(parseAmount(d.amount));
  if (!(amount > 0)) return toast('Enter an amount');
  S.upsert('incomes', {
    id: d.id || undefined, name: d.name.trim(), amount, member: d.member, frequency: d.frequency,
    dueDay: +d.dueDay || 1, anchorDate: d.anchorDate, keywords: d.keywords.trim(), active: d.active === 'on', varies: d.varies === 'on',
  }, { silent: true });
  const found = relinkIncomes();
  S.save();
  closeSheet();
  toast((d.id ? 'Income saved' : 'Income added') + (found ? ` · ${found} pay${found === 1 ? '' : 's'} found in your imports` : ''));
}

// ---------- Categories & budget ----------
const groupOptions = selected => S.groups().map(g => `<option value="${g.id}" ${g.id === selected ? 'selected' : ''}>${esc(g.name)}</option>`).join('');

export function categoryForm(c, groupId) {
  const isNew = !c;
  c = c || { icon: '🏷️', group: groupId || S.groups()[0]?.id, budget: 0, type: 'out' };
  openSheet(`${sheetHead(isNew ? 'New category' : 'Edit category')}
  <form class="form" data-form="category">
    <input type="hidden" name="id" value="${c.id || ''}">
    <div class="row-icon"><label class="field"><span>Icon</span><input name="icon" value="${esc(c.icon)}" maxlength="4" class="emoji-input"></label>
      <label class="field grow"><span>Name</span><input name="name" value="${esc(c.name || '')}" required placeholder="e.g. Football club"></label></div>
    <div class="row2">
      <label class="field"><span>Monthly budget</span><input name="budget" inputmode="decimal" value="${c.budget || ''}" placeholder="0"></label>
      <label class="field"><span>Spending area</span><select name="group">${groupOptions(c.group)}</select></label>
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

// ---------- Spending areas (groups) ----------
export function groupForm(g) {
  const isNew = !g;
  const all = S.groups();
  if (isNew && !S.freeSlot()) return toast(`You can have up to ${S.MAX_GROUPS} spending areas`);
  g = g || { name: '', savings: false };
  const cats = isNew ? [] : S.list('categories').filter(c => c.group === g.id && (c.type || 'out') === 'out');
  const others = all.filter(x => x.id !== g.id);
  const positions = isNew ? all.length + 1 : all.length;
  const current = isNew ? all.length : all.findIndex(y => y.id === g.id);
  openSheet(`${sheetHead(isNew ? 'New spending area' : 'Edit spending area', 'Group your categories however suits your family')}
  <form class="form" data-form="group">
    <input type="hidden" name="id" value="${g.id || ''}">
    <label class="field"><span>Name</span><input name="name" value="${esc(g.name)}" required placeholder="e.g. Bills, Subscriptions, Kids, Fun money" autofocus></label>
    <label class="field"><span>Position in the list</span><select name="order">${Array.from({ length: positions }, (_, i) => `<option value="${i}" ${i === current ? 'selected' : ''}>${i + 1}${i === 0 ? ' (top)' : ''}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="savings" ${g.savings ? 'checked' : ''}> This is money we put aside as <b>savings</b>, not spending</label>
    ${!isNew ? `<div class="field"><span>Categories in this area (${cats.length})</span>
      <div class="chips">${cats.map(c => `<span class="chip-static">${c.icon} ${esc(c.name)}</span>`).join('') || '<span class="muted small">None yet</span>'}</div>
      <small class="muted">To move a category, tap it in Plan → Budget and change its spending area.</small></div>` : ''}
    ${!isNew && others.length ? `<details class="howto"><summary>Delete this area</summary>
      <label class="field mt"><span>Move its categories to</span><select name="moveTo">${others.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
      <button type="button" class="btn danger mt" data-action="deleteGroup" data-id="${g.id}">Delete ${esc(g.name)}</button></details>` : ''}
    <div class="form-actions"><button class="btn primary" type="submit">${isNew ? 'Add area' : 'Save'}</button></div>
  </form>`);
}

function reorder(id, to) {
  const ids = S.groups().map(x => x.id).filter(x => x !== id);
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
  ids.forEach((gid, i) => {
    const g = S.getState().groups.find(x => x.id === gid);
    if (g && g.order !== i) { g.order = i; g.updatedAt = Date.now(); }
  });
}

function saveGroup(d) {
  const existing = d.id && S.byId('groups', d.id);
  const g = S.upsert('groups', {
    id: d.id || undefined, name: d.name.trim(), savings: d.savings === 'on',
    slot: existing ? existing.slot : S.freeSlot(), order: existing ? existing.order : 999, target: existing?.target ?? 0,
  }, { silent: true });
  reorder(g.id, +d.order);
  S.save();
  closeSheet();
  toast(existing ? 'Spending area saved' : `${g.name} added — now move categories into it`);
}

function deleteGroup(el) {
  const f = el.form, id = el.dataset.id, to = f.moveTo.value;
  const g = S.byId('groups', id), dest = S.byId('groups', to);
  if (!confirm(`Delete ${g.name}? Its categories move to ${dest.name}.`)) return;
  for (const c of S.getState().categories) if (c.group === id) { c.group = to; c.updatedAt = Date.now(); }
  S.remove('groups', id, { silent: true });
  reorder(to, S.groups().findIndex(x => x.id === to));
  S.save();
  closeSheet();
  toast(`${g.name} deleted`);
}

// ---------- 50/30/20-style helper, across whatever areas you have ----------
export function budgetHelper() {
  const income = Math.round(expectedIn(periodOf(view.period)) || sum(S.list('incomes'), i => perMonth(incomeAmount(i), i.frequency)));
  const gs = S.groups();
  openSheet(`${sheetHead('Budget helper', 'Share your take-home pay across your spending areas (e.g. 50/30/20)')}
  <form class="form" data-form="budgetHelper">
    <label class="field"><span>Monthly take-home pay (all of you)</span><input name="income" inputmode="decimal" value="${income || ''}" required></label>
    <div class="helper-grid">${gs.map(g => `<label class="field"><span><i class="dot" style="background:${g.color}"></i>${esc(g.name)} %</span><input name="pct_${g.id}" type="number" min="0" max="100" value="${g.target || 0}"></label>`).join('')}</div>
    <div class="notice" id="helper-preview"></div>
    <p class="small muted">Each area's budget is shared across its categories in the same proportions you have now. Areas left at 0% aren't changed.</p>
    <div class="form-actions"><button class="btn primary" type="submit">Apply to my budget</button></div>
  </form>`, {
    onMount: sheet => {
      const f = $('form', sheet);
      const upd = () => {
        const inc = parseAmount(f.income.value);
        const pcts = gs.map(g => +f['pct_' + g.id].value || 0);
        const tot = pcts.reduce((a, b) => a + b, 0);
        $('#helper-preview', sheet).innerHTML = gs.map((g, i) => pcts[i] ? `${esc(g.name)}: <b>${money((inc * pcts[i]) / 100, { whole: true })}</b>` : '').filter(Boolean).join(' · ') +
          (tot !== 100 ? `<br><span class="status warn">● Adds up to ${tot}%, not 100%</span>` : '');
      };
      f.addEventListener('input', upd); upd();
    },
  });
}

function applyBudgetHelper(d) {
  const inc = parseAmount(d.income);
  for (const g of S.groups()) {
    const pct = +d['pct_' + g.id] || 0;
    const stored = S.byId('groups', g.id);
    if (stored.target !== pct) { stored.target = pct; stored.updatedAt = Date.now(); }
    if (!pct) continue;
    const target = (inc * pct) / 100;
    const cats = S.list('categories').filter(c => c.group === g.id && (c.type || 'out') === 'out');
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
const POT_SLOTS = [3, 1, 5, 4, 7, 2, 6, 8];
const nextPotSlot = () => {
  const used = new Set(S.list('pots').map(p => p.slot));
  return POT_SLOTS.find(s => !used.has(s)) || POT_SLOTS[S.list('pots').length % POT_SLOTS.length];
};

export function potForm(p) {
  const isNew = !p;
  p = p || { icon: '🐷', slot: nextPotSlot() };
  openSheet(`${sheetHead(isNew ? 'New savings pot' : 'Edit pot')}
  <form class="form" data-form="pot">
    <input type="hidden" name="id" value="${p.id || ''}">
    <div class="row-icon"><label class="field"><span>Icon</span><input name="icon" value="${esc(p.icon)}" maxlength="4" class="emoji-input"></label>
      <label class="field grow"><span>Saving for</span><input name="name" value="${esc(p.name || '')}" required placeholder="e.g. Holiday 2027"></label></div>
    <div class="field"><span>Jar colour</span><div class="swatches" role="radiogroup" aria-label="Jar colour">${POT_SLOTS.map(s =>
      `<label><input type="radio" name="slot" value="${s}" ${s === (p.slot || 3) ? 'checked' : ''}><span style="background:var(--s${s})"></span></label>`).join('')}</div></div>
    <div class="row2">
      <label class="field"><span>Goal</span><input name="goal" inputmode="decimal" value="${p.goal || ''}" placeholder="e.g. 3000"></label>
      <label class="field"><span>By when</span><input name="targetDate" type="date" value="${p.targetDate || ''}"></label>
    </div>
    ${isNew ? `<label class="field"><span>Already saved</span><input name="start" inputmode="decimal" placeholder="0"></label>` : ''}
    ${actionsRow(isNew, 'deletePot', p.id)}
  </form>`);
}

function savePot(d) {
  const pot = { id: d.id || undefined, name: d.name.trim(), icon: d.icon.trim() || '🐷', goal: round2(parseAmount(d.goal)), targetDate: d.targetDate, slot: +d.slot || 3 };
  if (!d.id) {
    pot.entries = [];
    const start = round2(parseAmount(d.start));
    if (start) pot.entries.push({ id: S.uid(), date: todayISO(), amount: start, note: 'Starting balance', by: S.settings().currentMember, at: Date.now() });
  }
  S.upsert('pots', pot);
  closeSheet();
  toast(d.id ? 'Pot saved' : `${pot.icon} ${pot.name} is ready — let's fill it!`);
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

// Put money in (or take it out) of a pot. Returns the entry so it can be undone.
function addToPot(p, amount, { date = todayISO(), note = '', record = true } = {}) {
  const entry = { id: S.uid(), date, amount, note, by: S.settings().currentMember, at: Date.now() };
  if (record) {
    const isIn = amount > 0;
    const tx = S.upsert('transactions', {
      type: isIn ? 'out' : 'in', amount: Math.abs(amount), date, desc: `${isIn ? 'To' : 'From'} ${p.name} pot`,
      categoryId: isIn ? 'savings' : 'otherin', member: S.settings().currentMember, source: 'pot',
    }, { silent: true });
    entry.txId = tx.id;
  }
  p.entries = [...(p.entries || []), entry];
  S.upsert('pots', p);
  return entry;
}

function undoPotEntry(potId, entryId) {
  const p = S.byId('pots', potId);
  const e = (p?.entries || []).find(x => x.id === entryId);
  if (!e) return;
  if (e.txId) S.remove('transactions', e.txId, { silent: true });
  p.entries = p.entries.filter(x => x.id !== entryId);
  S.upsert('pots', p);
}

// 🎉 The fun bit: confetti for every deposit, more for milestones, a party for a full pot.
function cheer(p, before) {
  const after = potPct(p);
  const color = getComputedStyle(document.documentElement).getPropertyValue(`--s${p.slot || 3}`).trim() || '#1baf7a';
  const crossed = MILESTONES.filter(m => before < m && after >= m);
  if (crossed.includes(100)) {
    confetti({ count: 220, colors: [color, '#f2b33d', '#ffd56e', '#ffffff'] });
    buzz([60, 40, 60, 40, 120]);
    setTimeout(() => openSheet(`<div class="goal-party">
      <div class="party-emoji">${p.icon || '🐷'}</div>
      <h2>You did it! 🎉</h2>
      <p><b>${esc(p.name)}</b> is full — ${money(potSaved(p))} saved.</p>
      <p class="muted small">Every dollar you two put aside got you here.</p>
      <button class="btn primary big" data-action="closeSheet">Woohoo!</button></div>`), 450);
    return;
  }
  if (crossed.length) {
    confetti({ count: 140, colors: [color, '#f2b33d', '#ffffff'] });
    buzz([40, 30, 80]);
    return `🏁 ${crossed[crossed.length - 1]}% of the way to ${p.name}!`;
  }
  confetti({ count: 60, colors: [color, '#f2b33d'] });
  buzz(30);
  return null;
}

function savePotEntry(d) {
  const p = S.byId('pots', d.id);
  const amount = round2(parseAmount(d.amount));
  if (!(amount > 0)) return toast('Enter an amount');
  const isIn = d.dir === 'in';
  const before = potPct(p);
  addToPot(p, isIn ? amount : -amount, { date: d.date, note: d.note.trim(), record: d.record === 'on' });
  closeSheet();
  const msg = isIn ? cheer(S.byId('pots', p.id), before) : null;
  toast(msg || (isIn ? `💰 ${money(amount)} added to ${p.name}` : `${money(amount)} taken from ${p.name}`));
}

function quickAdd(el) {
  const p = S.byId('pots', el.dataset.id);
  const amount = +el.dataset.amt;
  const before = potPct(p);
  const entry = addToPot(p, amount);
  const msg = cheer(S.byId('pots', p.id), before);
  toast(msg || `💰 ${money(amount, { whole: true })} added to ${p.name}`, { label: 'Undo', fn: () => undoPotEntry(p.id, entry.id) });
}

// ---------- Accounts (offset + home loan, credit card, main…) ----------
const KIND_LABELS = { offset: 'Offset account (with home loan)', credit: 'Credit card', everyday: 'Main / everyday account', savings: 'Savings account' };

export function accountForm(a) {
  const isNew = !a;
  a = a || { kind: 'everyday' };
  openSheet(`${sheetHead(isNew ? 'New account' : a.kind === 'credit' ? 'Card settings' : 'Account settings', a.kind === 'credit' ? 'Set the limit and C.A.S.H works out the rest' : 'Track a balance you check regularly')}
  <form class="form" data-form="account" data-kind="${a.kind}">
    <input type="hidden" name="id" value="${a.id || ''}">
    <label class="field"><span>Name</span><input name="name" value="${esc(a.name || '')}" required placeholder="e.g. NAB Main, NAB Offset, NAB Qantas card"></label>
    <label class="field"><span>Type</span><select name="kind" data-kind-select>${Object.entries(KIND_LABELS).map(([v, l]) => `<option value="${v}" ${v === a.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field if-credit"><span>Credit limit</span><input name="limit" inputmode="decimal" value="${a.limit ?? ''}" placeholder="e.g. 10000"><small class="muted">With the limit set, you only need to type either the amount owing or the available balance</small></label>
    <label class="field if-offset"><span>Home-loan interest rate (%)</span><input name="rate" inputmode="decimal" value="${a.rate ?? ''}" placeholder="e.g. 6.19"><small class="muted">Used to show how much interest your offset is saving</small></label>
    <label class="field"><span>Account number ends in <small class="muted">(optional — last 4 digits only)</small></span><input name="last4" inputmode="numeric" maxlength="4" value="${esc(a.last4 || '')}" placeholder="1234"></label>
    <label class="field if-offset"><span>Home loan account ends in <small class="muted">(optional — helps match home-loan statements)</small></span><input name="loanLast4" inputmode="numeric" maxlength="4" value="${esc(a.loanLast4 || '')}" placeholder="5678"></label>
    ${isNew ? `<label class="field"><span>Current balance <small class="muted">(for a card: the amount owing)</small></span><input name="balance" inputmode="decimal" placeholder="0.00"></label>
      <label class="field if-offset"><span>Home loan balance owing</span><input name="loan" inputmode="decimal" placeholder="e.g. 354358.27"></label>` : ''}
    ${actionsRow(isNew, 'deleteAccount', a.id)}
  </form>`, {
    onMount: sheet => {
      const sel = $('[data-kind-select]', sheet);
      sel.addEventListener('change', () => { sel.form.dataset.kind = sel.value; });
    },
  });
}

// Record today's figures (one entry per day; a second update the same day replaces it).
// vals: { balance, loan (home loan owing), available (card) } — any subset.
export function recordBalance(a, vals, date = todayISO(), { silent = false } = {}) {
  if (typeof vals === 'number') vals = { balance: vals };
  const hist = (a.history || []).map(h => ({ ...h }));
  let e = hist.find(h => h.date === date);
  if (!e) {
    const prev = hist.filter(h => h.date < date).pop() || {};
    e = { date, balance: prev.balance ?? a.balance ?? null };
    if (prev.loan ?? a.loanBalance) e.loan = prev.loan ?? a.loanBalance;
    hist.push(e);
  }
  if ('balance' in vals && !('available' in vals)) delete e.available;
  Object.assign(e, vals, { by: S.settings().currentMember });
  hist.sort((x, y) => x.date.localeCompare(y.date));
  const latest = hist[hist.length - 1];
  return S.upsert('accounts', {
    ...a, history: hist.slice(-400), balance: latest.balance ?? null,
    loanBalance: latest.loan ?? a.loanBalance ?? null, available: latest.available ?? null,
  }, { silent });
}

const owing = v => Math.abs(round2(parseAmount(v)));

function saveAccount(d) {
  const old = d.id ? S.byId('accounts', d.id) : null;
  const acc = {
    ...(old || { history: [], balance: null }), id: d.id || undefined, name: d.name.trim(), kind: d.kind,
    limit: d.limit ? round2(parseAmount(d.limit)) : null, rate: d.rate ? parseFloat(d.rate) : null,
    last4: (d.last4 || '').replace(/\D/g, '').slice(-4), loanLast4: (d.loanLast4 || '').replace(/\D/g, '').slice(-4),
  };
  const saved = S.upsert('accounts', acc, { silent: true });
  if (!old && (d.balance || d.loan)) {
    const vals = {};
    if (d.balance) vals.balance = d.kind === 'credit' ? owing(d.balance) : round2(parseAmount(d.balance));
    if (d.kind === 'offset' && d.loan) vals.loan = owing(d.loan);
    recordBalance(saved, vals, todayISO(), { silent: true });
  }
  S.save();
  closeSheet();
  toast('Account saved');
}

export function balanceForm(a) {
  const credit = a.kind === 'credit', offset = a.kind === 'offset';
  const num = v => (v == null ? '' : round2(v).toFixed(2));
  openSheet(`${sheetHead(`Update ${a.name}`, 'Copy today\'s figures from the NAB app')}
  <form class="form" data-form="balance">
    <input type="hidden" name="id" value="${a.id}">
    <label class="field"><span>${credit ? 'Amount owing' : offset ? 'Offset balance' : 'Balance'}</span><input name="amount" inputmode="decimal" value="${num(a.balance)}" ${credit && a.limit ? '' : 'required'} autofocus></label>
    ${offset ? `<label class="field"><span>Home loan balance owing</span><input name="loan" inputmode="decimal" value="${num(a.loanBalance)}" placeholder="e.g. 354358.27"><small class="muted">Type it with or without the minus sign</small></label>` : ''}
    ${credit ? `<label class="field"><span>Available balance</span><input name="available" inputmode="decimal" placeholder="${a.limit ? 'Or type this instead' : 'From the NAB app (optional)'}"></label>
      <p class="small ${a.limit ? 'muted' : 'status warn'}" id="card-calc">${a.limit ? `Limit ${money(a.limit, { whole: true })}: type either figure and the other is worked out.` : `● Add your credit limit with ${icon('gear', 13)} to have this worked out for you.`}</p>` : ''}
    <label class="field"><span>Date</span><input type="date" name="date" value="${todayISO()}" max="${todayISO()}"></label>
    <p class="small muted">Or import a NAB statement for this account and C.A.S.H reads the latest balance for you.</p>
    <div class="form-actions"><button class="btn primary" type="submit">Save</button></div>
  </form>`, {
    onMount: sheet => {
      if (!credit || !a.limit) return;
      // live: typing one figure fills in the other from the limit
      const f = $('form', sheet), out = $('#card-calc', sheet);
      const show = src => {
        const v = Math.abs(parseAmount(src.value));
        if (!src.value.trim()) return;
        const other = round2(a.limit - v);
        out.innerHTML = src.name === 'amount'
          ? `Owing ${money(v)} → <b class="pos">${money(other)} available</b>`
          : `Available ${money(v)} → <b class="neg">${money(-other)} owing</b>`;
      };
      f.amount.addEventListener('input', () => { f.available.value = ''; show(f.amount); });
      f.available.addEventListener('input', () => { f.amount.value = ''; show(f.available); });
    },
  });
}

function saveBalance(d) {
  const a = S.byId('accounts', d.id);
  const vals = {};
  if (a.kind === 'credit') {
    const owe = d.amount.trim() ? owing(d.amount) : null;
    const avail = d.available.trim() ? round2(parseAmount(d.available)) : null;
    if (owe == null && avail == null) return toast('Type the amount owing or the available balance');
    // with a limit, one figure gives the other
    vals.balance = owe ?? (a.limit ? round2(a.limit - avail) : null);
    if (vals.balance == null) return toast('Add your credit limit (⚙️) or type the amount owing');
    if (avail != null && owe != null) vals.available = avail;
    else if (avail != null && !a.limit) vals.available = avail;
  } else {
    vals.balance = round2(parseAmount(d.amount));
    if (a.kind === 'offset' && d.loan) vals.loan = owing(d.loan);
  }
  recordBalance(a, vals, d.date || todayISO());
  closeSheet();
  toast(`${a.name} updated`);
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
  account: saveAccount, balance: saveBalance, group: saveGroup, bulkMove: saveBulkMove,
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
  newCategory: el => categoryForm(null, el.dataset.group),
  rules: () => rulesSheet(),
  repeatSpend: el => repeatSpend(el),
  newRule: () => similarSheet({ title: 'New rule' }),
  deleteRule: el => { removeRule(el.dataset.key); S.save(); rulesSheet(); toast('Rule deleted'); },
  moveSearch: () => similarSheet({ text: view.filters.q.trim(), title: `Move “${view.filters.q.trim()}” payments` }),
  newGroup: () => groupForm(),
  editGroup: el => groupForm(S.byId('groups', el.dataset.id)),
  deleteGroup: el => deleteGroup(el),
  editCategory: el => categoryForm(S.byId('categories', el.dataset.id)),
  deleteCategory: el => deleteCategory(el.dataset.id),
  budgetHelper: () => budgetHelper(),
  newPot: () => potForm(),
  editPot: el => potForm(S.byId('pots', el.dataset.id)),
  deletePot: el => { if (confirm('Delete this pot and its history?')) { S.remove('pots', el.dataset.id); closeSheet(); } },
  potIn: el => potEntryForm(S.byId('pots', el.dataset.id), 'in'),
  potOut: el => potEntryForm(S.byId('pots', el.dataset.id), 'out'),
  potQuick: el => quickAdd(el),
  newAccount: () => accountForm(),
  editAccount: el => accountForm(S.byId('accounts', el.dataset.id)),
  deleteAccount: el => { if (confirm('Delete this account and its balance history? Payments stay.')) { S.remove('accounts', el.dataset.id); closeSheet(); } },
  updateBalance: el => balanceForm(S.byId('accounts', el.dataset.id)),
};


