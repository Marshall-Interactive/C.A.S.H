// All household data lives in one state object, saved to this device.
// Every record carries an id, updatedAt and a soft-delete flag so that
// two phones can later be merged record-by-record (see README: Family sync).

const KEY = 'cash.v1';
const listeners = new Set();
let state = null;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Spending groups ("areas") are the family's own: rename, add, reorder, delete.
// Each keeps a fixed chart colour slot (1-8) for life, so its colour never
// changes when other groups come and go. savings: true marks money put aside.
export const MAX_GROUPS = 8;
const defaultGroups = () => [
  { id: 'essential', name: 'Essentials', slot: 1, order: 0, target: 50, savings: false },
  { id: 'lifestyle', name: 'Lifestyle', slot: 2, order: 1, target: 30, savings: false },
  { id: 'savings', name: 'Savings', slot: 3, order: 2, target: 20, savings: true },
  { id: 'other', name: 'Other', slot: 4, order: 3, target: 0, savings: false },
].map(g => ({ ...g, updatedAt: Date.now() }));

export const groups = () => list('groups').sort((a, b) => a.order - b.order)
  .map(g => ({ ...g, color: `var(--s${g.slot})` }));
export const group = id => groups().find(g => g.id === id)
  || { id: 'ungrouped', name: 'Ungrouped', color: 'var(--line-2)', savings: false, order: 99 };
export const freeSlot = () => {
  const used = new Set(list('groups').map(g => g.slot));
  for (let i = 1; i <= MAX_GROUPS; i++) if (!used.has(i)) return i;
  return null;
};

// The starter budget template (Australian household, AUD a month):
// [id, name, icon, group, monthly budget, type]
// type 'transfer' = money moving between your own accounts (e.g. paying off
// the credit card from the offset) — never counted as spending or income.
const TEMPLATE = [
  ['housing', 'Mortgage / Rent', '🏠', 'essential', 2600],
  ['counciltax', 'Council Rates', '🏛️', 'essential', 200],
  ['energy', 'Electricity & Gas', '⚡', 'essential', 250],
  ['water', 'Water', '💧', 'essential', 90],
  ['broadband', 'Internet & Phones', '📶', 'essential', 130],
  ['insurance', 'Home & Car Insurance', '🛡️', 'essential', 150],
  ['healthins', 'Health Insurance', '🏥', 'essential', 300],
  ['groceries', 'Groceries', '🛒', 'essential', 1200],
  ['transport', 'Fuel, Tolls & Transport', '🚗', 'essential', 350],
  ['car', 'Car Rego & Servicing', '🔧', 'essential', 100],
  ['childcare', 'Childcare & School', '🎒', 'essential', 400],
  ['debt', 'Loans & Credit Cards', '💳', 'essential', 0],
  ['eatingout', 'Eating Out & Takeaway', '🍔', 'lifestyle', 250],
  ['shopping', 'Shopping & Clothes', '🛍️', 'lifestyle', 200],
  ['subscriptions', 'Subscriptions', '📺', 'lifestyle', 70],
  ['entertainment', 'Days Out & Fun', '🎟️', 'lifestyle', 150],
  ['kids', 'Kids & Activities', '🧸', 'lifestyle', 150],
  ['health', 'Health & Beauty', '💊', 'lifestyle', 80],
  ['gifts', 'Gifts & Celebrations', '🎁', 'lifestyle', 80],
  ['pets', 'Pets', '🐾', 'lifestyle', 80],
  ['home', 'Home & Garden', '🔨', 'lifestyle', 100],
  ['holidays', 'Holidays', '✈️', 'lifestyle', 200],
  ['savings', 'Savings', '🐷', 'savings', 500],
  ['emergency', 'Emergency Fund', '🆘', 'savings', 200],
  ['other', 'Other', '📦', 'other', 0],
  ['wages', 'Wages', '💵', 'other', 0, 'in'],
  ['benefits', 'Family Tax Benefit & Centrelink', '👶', 'other', 0, 'in'],
  ['refund', 'Refunds', '↩️', 'other', 0, 'in'],
  ['otherin', 'Other Income', '➕', 'other', 0, 'in'],
  ['transfer', 'Transfer between accounts', '🔁', 'transfer', 0, 'transfer'],
];

// Colours people can pick for themselves (chart palette slots).
export const PERSON_COLOURS = ['#2a78d6', '#e87ba4', '#1baf7a', '#eb6834', '#6250d6', '#eda100', '#008300', '#e34948'];

export const CURRENCIES = { AUD: 'en-AU', NZD: 'en-NZ', GBP: 'en-GB', USD: 'en-US', EUR: 'en-IE' };

const defaultAccounts = () => [
  { id: uid(), name: 'Offset account', kind: 'offset', balance: null, rate: null, history: [], updatedAt: Date.now() },
  { id: uid(), name: 'Credit card', kind: 'credit', balance: null, limit: null, history: [], updatedAt: Date.now() },
];

export function templateCategories() {
  return TEMPLATE.map(([id, name, icon, group, budget, type = 'out']) =>
    ({ id, name, icon, group, budget, type, updatedAt: Date.now() }));
}

export function blankState(settings = {}) {
  const s = {
    version: 3,
    createdAt: Date.now(),
    settings: {
      householdName: 'Our Family',
      members: ['Me', 'Partner'],
      memberColors: {},
      currentMember: 'Me',
      currency: 'AUD',
      locale: 'en-AU',
      monthStartDay: 1,
      theme: 'auto',
      ...settings,
    },
    categories: templateCategories(),
    groups: defaultGroups(),
    transactions: [],
    bills: [],
    incomes: [],
    pots: [],
    accounts: defaultAccounts(),
    rules: {},
  };
  ensureColours(s.settings);
  return s;
}

export function ensureColours(st) {
  st.memberColors ||= {};
  st.members.forEach((m, i) => { st.memberColors[m] ||= PERSON_COLOURS[i % PERSON_COLOURS.length]; });
}

// v1 (first build) was set up for the UK — move it to Australia.
function migrate(s) {
  if ((s.version || 1) < 2) {
    s.settings.currency = 'AUD';
    s.settings.locale = 'en-AU';
    const tpl = templateCategories();
    for (const t of tpl) {
      const c = s.categories.find(c => c.id === t.id);
      if (!c) s.categories.push(t);
      else { c.name = t.name; c.icon = t.icon; c.type = t.type; c.group = t.group; }
    }
    s.accounts ||= defaultAccounts();
    s.version = 2;
  }
  if (s.version < 3) {
    s.groups ||= defaultGroups();
    s.version = 3;
  }
  s.accounts ||= [];
  s.groups ||= defaultGroups();
  ensureColours(s.settings);
  return s;
}

export function load() {
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
  if (state) {
    const v = state.version;
    migrate(state);
    if (v !== state.version) localStorage.setItem(KEY, JSON.stringify(state));
  }
  return state;
}

export const getState = () => state;
export const settings = () => state.settings;

export function setState(s) { state = migrate(s); save(); }

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    alert('C.A.S.H could not save — this device may be out of storage.');
  }
  listeners.forEach(fn => fn());
}

export function wipe() { localStorage.removeItem(KEY); state = null; }

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export const list = coll => state[coll].filter(x => !x.deleted);
export const byId = (coll, id) => state[coll].find(x => x.id === id && !x.deleted);

export function upsert(coll, obj, { silent = false } = {}) {
  if (!obj.id) obj.id = uid();
  obj.updatedAt = Date.now();
  obj.by = state.settings.currentMember;
  const i = state[coll].findIndex(x => x.id === obj.id);
  let saved;
  if (i >= 0) saved = state[coll][i] = { ...state[coll][i], ...obj };
  else state[coll].push(saved = obj);
  if (!silent) save();
  return saved;
}

export function remove(coll, id, { silent = false } = {}) {
  const x = state[coll].find(x => x.id === id);
  if (x) { x.deleted = true; x.updatedAt = Date.now(); }
  if (!silent) save();
}

export const isTransfer = id => byId('categories', id)?.type === 'transfer';

export const memberColor = name => state?.settings.memberColors?.[name] || 'var(--muted)';

export function cat(id) {
  return byId('categories', id) || byId('categories', 'other') ||
    { id: 'other', name: 'Other', icon: '📦', group: 'other', budget: 0, type: 'out' };
}
