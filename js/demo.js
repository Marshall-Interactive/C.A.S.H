// Sample household so the app can be explored before real data goes in.
import { blankState, uid } from './store.js';
import { toISO, round2 } from './util.js';
import { occurrences } from './calc.js';

export function demoState(settings = {}) {
  const st = blankState(settings);
  const [a, b] = st.settings.members.length > 1 ? st.settings.members : [st.settings.members[0], 'Partner'];
  if (st.settings.members.length < 2) st.settings.members = [a, b];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const now = Date.now();
  const stamp = o => ({ id: uid(), updatedAt: now, ...o });

  st.incomes = [
    stamp({ name: `Wages – ${a}`, member: a, amount: 3150, frequency: 'fortnightly', anchorDate: '2026-01-08', keywords: 'salary', active: true }),
    stamp({ name: `Wages – ${b}`, member: b, amount: 1980, frequency: 'fortnightly', anchorDate: '2026-01-15', keywords: 'wages', active: true }),
    stamp({ name: 'Family Tax Benefit', member: b, amount: 245.6, frequency: 'fortnightly', anchorDate: '2026-01-13', keywords: 'centrelink', active: true }),
  ];
  const bill = (name, amount, categoryId, dueDay, method = 'Direct Debit', payer = 'Joint', extra = {}) =>
    stamp({ name, amount, categoryId, frequency: 'monthly', dueDay, method, payer, active: true, ...extra });
  st.bills = [
    bill('Home loan', 2780, 'housing', 1),
    bill('AGL Electricity & Gas', 245, 'energy', 6),
    bill('Telstra NBN', 95, 'broadband', 12),
    bill('Optus mobiles', 70, 'broadband', 14, 'Direct Debit', a),
    bill('Medibank', 318, 'healthins', 3),
    bill('Childcare', 420, 'childcare', 1, 'Direct Debit', b),
    bill('Netflix', 18.99, 'subscriptions', 8, 'Card', a),
    bill('Spotify Family', 23.99, 'subscriptions', 18, 'Card', b),
    bill('Kayo', 30, 'subscriptions', 22, 'Card', a),
    bill('Gym', 64, 'health', 3, 'Direct Debit', b),
    stamp({ name: 'Council rates', amount: 560, categoryId: 'counciltax', frequency: 'quarterly', anchorDate: '2026-02-28', method: 'BPAY', payer: 'Joint', active: true }),
    stamp({ name: 'Water', amount: 290, categoryId: 'water', frequency: 'quarterly', anchorDate: '2026-01-20', method: 'BPAY', payer: 'Joint', active: true }),
    stamp({ name: 'Car rego & CTP', amount: 890, categoryId: 'car', frequency: 'yearly', anchorDate: '2026-03-15', method: 'Card', payer: a, active: true }),
    stamp({ name: 'Home & contents insurance', amount: 1650, categoryId: 'insurance', frequency: 'yearly', anchorDate: '2026-05-01', method: 'Card', payer: 'Joint', active: true }),
    bill('Car insurance', 98, 'insurance', 20, 'Direct Debit', a),
  ];

  const tx = [];
  const today = new Date();
  const todayIso = toISO(today);
  const add = (o) => { if (o.date <= todayIso) tx.push(stamp({ source: 'manual', ...o })); };
  const day = (y, m, d) => toISO(new Date(y, m, d));

  for (let k = 3; k >= 0; k--) {
    const y = today.getFullYear(), m = today.getMonth() - k;
    const p = { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
    for (const coll of ['incomes', 'bills']) {
      for (const item of st[coll]) {
        for (const d of occurrences(item, p)) {
          const iso = toISO(d);
          if (iso > todayIso) continue;
          const isBill = coll === 'bills';
          const t = stamp({ type: isBill ? 'out' : 'in', amount: item.amount, desc: item.name, date: iso,
            categoryId: isBill ? item.categoryId : (item.name === 'Family Tax Benefit' ? 'benefits' : 'wages'),
            member: isBill ? item.payer : item.member, source: isBill ? 'bill' : 'income', [isBill ? 'billId' : 'incomeId']: item.id });
          tx.push(t);
          const key = isBill ? 'paid' : 'received';
          item[key] = { ...(item[key] || {}), [iso]: t.id };
        }
      }
    }
    const shop = (n, cat, names, lo, hi) => {
      for (let i = 0; i < n; i++) add({ type: 'out', amount: round2(lo + rnd() * (hi - lo)), desc: pick(names), categoryId: cat, date: day(y, m, 1 + Math.floor(rnd() * 28)), member: pick([a, b]) });
    };
    shop(8, 'groceries', ['Woolworths', 'Coles', 'Aldi', 'IGA'], 35, 240);
    shop(4, 'transport', ['Ampol', 'BP', '7-Eleven', 'Shell'], 60, 95);
    shop(1, 'transport', ['Linkt tolls'], 30, 60);
    shop(4, 'eatingout', ['Guzman y Gomez', 'Menulog', "McDonald's", 'Local cafe', 'Uber Eats'], 9, 65);
    shop(2, 'shopping', ['Kmart', 'Big W', 'Target', 'Amazon'], 20, 120);
    shop(2, 'kids', ['Swim school', 'Smiggle', 'School excursion'], 15, 60);
    shop(1, 'entertainment', ['Event Cinemas', 'Timezone', 'Zoo'], 30, 90);
    shop(1, 'health', ['Chemist Warehouse', 'Priceline'], 12, 45);
    shop(1, 'pets', ['Petbarn'], 30, 70);
    shop(1, 'home', ['Bunnings', 'IKEA'], 15, 110);
    if (rnd() > 0.4) shop(1, 'gifts', ['Florist', 'Gift shop'], 20, 60);
    // one receipt split across categories, to show off splitting
    const amt1 = round2(40 + rnd() * 30), amt2 = round2(6 + rnd() * 8), amt3 = round2(4 + rnd() * 6);
    add({ type: 'out', amount: round2(amt1 + amt2 + amt3), desc: 'Woolworths', date: day(y, m, 12), member: a, source: 'receipt', categoryId: 'groceries',
      splits: [{ categoryId: 'groceries', amount: amt1 }, { categoryId: 'home', amount: amt2 }, { categoryId: 'health', amount: amt3 }] });
    add({ type: 'out', amount: 200, desc: 'To Emergency fund pot', date: day(y, m, 29), categoryId: 'savings', member: a, source: 'pot' });
    add({ type: 'out', amount: round2(900 + rnd() * 900), desc: 'Transfer to NAB credit card', date: day(y, m, 16), categoryId: 'transfer', member: a, source: 'csv' });
  }
  st.transactions = tx;
  const hist = (start, step, by) => Array.from({ length: 8 }, (_, i) => ({
    date: toISO(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (7 - i) * 3)),
    balance: round2(start + step * i + (rnd() - 0.5) * Math.abs(step)), by: i % 2 ? b : a,
  }));
  const offsetHist = hist(41200, 380, a), cardHist = hist(2150, -95, b);
  st.accounts = [
    stamp({ name: 'NAB Offset', kind: 'offset', rate: 6.09, last4: '4821', history: offsetHist, balance: offsetHist[7].balance }),
    stamp({ name: 'NAB Credit Card', kind: 'credit', limit: 10000, last4: '9034', history: cardHist, balance: cardHist[7].balance }),
  ];
  st.pots = [
    stamp({ name: 'Emergency fund', icon: '🆘', goal: 5000, targetDate: toISO(new Date(today.getFullYear() + 1, 5, 1)),
      entries: [{ id: uid(), date: toISO(new Date(today.getFullYear(), today.getMonth() - 4, 1)), amount: 1850, note: 'Starting balance' },
        { id: uid(), date: toISO(new Date(today.getFullYear(), today.getMonth() - 1, 29)), amount: 200, note: '' }] }),
    stamp({ name: 'Summer holiday', icon: '🏖️', goal: 2500, targetDate: toISO(new Date(today.getFullYear() + 1, 6, 1)),
      entries: [{ id: uid(), date: toISO(new Date(today.getFullYear(), today.getMonth() - 2, 1)), amount: 640, note: 'Starting balance' }] }),
    stamp({ name: 'Christmas', icon: '🎄', goal: 600, targetDate: `${today.getFullYear()}-12-01`,
      entries: [{ id: uid(), date: toISO(new Date(today.getFullYear(), today.getMonth() - 3, 1)), amount: 320, note: 'Starting balance' }] }),
  ];
  return st;
}
