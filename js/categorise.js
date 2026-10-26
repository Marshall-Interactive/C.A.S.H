// Auto-categorising: learned rules first (from your own corrections),
// then a built-in list of common Australian merchants and billers.
import * as S from './store.js';

export const normalise = d => String(d || '').toLowerCase()
  .replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Money moving between your own accounts — checked first, in and out.
const TRANSFER = ['transfer to', 'transfer from', 'tfr ', 'internet transfer', 'online transfer', 'payment received thank', 'payment thank you', 'thank you payment', 'cc payment', 'credit card payment', 'card repayment', 'to offset', 'from offset', 'linked acc', 'own account'];

// Order matters: more specific entries come first ("woolworths petrol" before "woolworths").
const OUT = {
  transport: ['woolworths petrol', 'coles express', 'ampol', 'caltex', ' bp ', 'shell', '7 eleven', '7eleven', 'united petroleum', 'puma energy', 'liberty oil', 'metro petroleum', 'eg fuel', 'petrol', 'fuel', 'linkt', 'e toll', 'etoll', 'citylink', 'eastlink', 'transurban', 'myki', 'opal', 'go card', 'translink', 'transperth', 'adelaide metro', 'uber', 'didi', '13cabs', 'parking', 'wilson parking', 'secure parking', 'cellopark'],
  car: ['rego', 'registration', 'service nsw', 'vicroads', 'tmr ', 'transport for nsw', 'ctp', 'green slip', 'mycar', 'ultra tune', 'midas', 'bob jane', 'supercheap', 'repco', 'autobarn', 'tyre'],
  broadband: ['telstra', 'optus', 'vodafone', 'tpg', 'aussie broadband', 'iinet', 'belong', 'superloop', 'dodo', 'boost mobile', 'amaysim', 'felix mobile', 'circles life', 'lebara', 'exetel', 'spintel', 'tangerine', 'more telecom', 'nbn'],
  subscriptions: ['netflix', 'spotify', 'disney', 'amazon prime', 'prime video', 'apple com', 'itunes', 'icloud', 'youtube', 'stan com', 'stan ', 'binge', 'foxtel', 'kayo', 'paramount', 'audible', 'playstation', 'xbox', 'google storage', 'google one', 'patreon', 'chatgpt', 'kindle'],
  energy: ['agl', 'origin energy', 'origin ', 'energyaustralia', 'energy australia', 'red energy', 'alinta', 'simply energy', 'momentum energy', 'powershop', 'lumo', 'ovo energy', 'globird', 'dodo power', 'synergy', 'aurora energy', 'actewagl', 'tango energy', 'amber electric'],
  water: ['water', 'sydney water', 'yarra valley', 'south east water', 'sa water', 'icon water', 'unitywater', 'urban utilities', 'hunter water', 'taswater'],
  counciltax: ['council', 'city of ', 'shire', 'rates'],
  healthins: ['medibank', 'bupa', ' hcf', 'nib ', 'ahm ', 'hbf', 'gmhba', 'teachers health', 'australian unity', 'health insurance', 'frank health'],
  insurance: ['insurance', 'nrma', 'racv', 'racq', ' raa ', ' rac ', 'aami', 'allianz', 'suncorp', 'youi', 'budget direct', 'qbe', 'gio ', 'coles insurance', 'woolworths insurance', 'real insurance', 'tal life', 'zurich'],
  housing: ['home loan', 'mortgage', 'loan repayment', ' rent ', 'rent payment', 'real estate', 'property management', 'ray white', 'lj hooker'],
  childcare: ['childcare', 'child care', 'early learning', 'kindergarten', 'kinder', 'oshc', 'before and after school', 'qkr', 'compass education', 'school fees', 'school'],
  debt: ['afterpay', 'zip pay', 'zippay', 'zip money', 'humm', 'latitude', 'klarna', 'personal loan', 'car loan', 'credit card fee', 'annual fee', 'interest charged'],
  groceries: ['woolworths', 'woolies', 'coles', 'aldi', 'iga', 'foodworks', 'harris farm', 'costco', 'drakes', 'spudshed', 'friendly grocer', 'supa iga', 'ritchies', 'foodland', 'butcher', 'bakery', 'fruit market', 'greengrocer'],
  eatingout: ['mcdonald', 'macca', 'kfc', 'hungry jack', 'red rooster', 'guzman', 'grill d', 'oporto', 'nando', 'domino', 'pizza hut', 'subway', 'menulog', 'doordash', 'uber eats', 'zambrero', 'mad mex', 'sushi', 'gyg', 'starbucks', 'gloria jean', 'cafe', 'coffee', 'restaurant', 'bakery cafe', 'hotel', 'tavern', ' pub', 'bistro', 'rsl', 'leagues club', 'muffin break', 'boost juice'],
  shopping: ['kmart', 'big w', 'target', 'myer', 'david jones', 'jb hi fi', 'jb hifi', 'harvey norman', 'the good guys', 'officeworks', 'amazon', 'amzn', 'ebay', 'catch com', 'temu', 'shein', 'cotton on', 'uniqlo', 'h&m', 'zara', 'rebel', 'best&less', 'best & less', 'lowes', 'cheap as chips', 'the reject shop', 'spotlight', 'lincraft', 'sportsgirl', 'jay jays', 'peter alexander', 'platypus', 'hype dc', 'glue store', 'country road', 'myer'],
  health: ['chemist warehouse', 'priceline', 'terry white', 'amcal', 'blooms', 'pharmacy', 'chemist', 'dental', 'dentist', 'medical centre', 'medical center', 'physio', 'optometrist', 'specsavers', 'opsm', 'bulk bill', 'pathology', 'anytime fitness', 'snap fitness', 'fitness first', 'jetts', 'plus fitness', 'goodlife', ' gym', 'hairdress', 'barber', 'beauty', 'salon', 'mecca', 'sephora'],
  pets: ['petbarn', 'petstock', 'pet circle', 'my pet warehouse', 'vet ', 'veterinary', 'greencross', 'pet insurance'],
  home: ['bunnings', 'mitre 10', 'mitre10', 'home timber', 'total tools', 'ikea', 'fantastic furniture', 'amart', 'freedom', 'adairs', 'bed bath', 'pillow talk', 'harris scarfe', 'beacon lighting', 'nursery', 'garden'],
  kids: ['toys r us', 'toyworld', 'mr toys', 'lego', 'smiggle', 'baby bunting', 'swim school', 'swimming', 'little athletics', 'football club', 'netball', 'dance', 'scouts', 'gymnastics'],
  entertainment: ['event cinemas', 'hoyts', 'village cinemas', 'reading cinemas', 'palace cinemas', 'ticketek', 'ticketmaster', 'moshtix', 'steam', 'nintendo', 'timezone', 'strike bowling', 'zone bowling', 'dreamworld', 'movie world', 'sea world', 'wet n wild', 'luna park', 'zoo', 'aquarium', 'museum', 'bounce', 'holey moley', 'tab ', 'sportsbet'],
  gifts: ['gift', 'florist', 'flowers', 'card shop', 'hallmark', 'typo', 'smiggle gift'],
  holidays: ['qantas', 'virgin australia', 'jetstar', 'rex airlines', 'booking com', 'airbnb', 'expedia', 'wotif', 'webjet', 'flight centre', 'hotels com', 'big4', 'discovery parks', 'stayz', 'accor', 'motel'],
  savings: ['savings', 'goal saver', 'bonus saver', 'netbank saver', 'ing savings', 'ubank save', 'term deposit', 'raiz', 'spaceship', 'stake', 'commsec', 'superhero', 'vanguard'],
};
const IN = {
  benefits: ['centrelink', 'services australia', 'family tax', 'ftb', 'child care subsidy', 'ccs ', 'dhs ', 'jobseeker', 'parenting payment', 'carer'],
  refund: ['refund', 'reversal', 'cashback', 'returned', 'ato ', 'tax return', 'medicare benefit', 'medicare', 'rebate'],
  wages: ['salary', 'wages', 'wage', 'payroll', 'pay ', 'pty ltd', 'pty', 'ltd', 'limited'],
};

export const MERCHANTS = ['Woolworths', 'Coles', 'Aldi', 'IGA', 'Costco', 'Harris Farm', 'Foodworks', 'Bunnings', 'Kmart', 'Big W', 'Target', 'Myer', 'David Jones', 'JB Hi-Fi', 'Harvey Norman', 'The Good Guys', 'Officeworks', 'Chemist Warehouse', 'Priceline', 'Terry White', 'Ampol', 'Caltex', 'BP', 'Shell', '7-Eleven', 'United', 'Coles Express', "McDonald's", 'KFC', "Hungry Jack's", 'Red Rooster', 'Guzman y Gomez', 'Subway', "Domino's", 'Pizza Hut', "Nando's", 'Starbucks', 'Petbarn', 'Petstock', 'Mitre 10', 'IKEA', 'Spotlight', 'Rebel', 'Cotton On', 'Best & Less', 'The Reject Shop', 'Dan Murphy\'s', 'BWS', 'Liquorland', 'Baby Bunting', 'Supercheap Auto', 'Repco', 'Amazon'];

const ruleKey = d => normalise(d).split(' ').filter(w => w.length > 1 && !/\d/.test(w)).slice(0, 3).join(' ');

export function guessCategory(desc, type = 'out') {
  const st = S.getState();
  const key = ruleKey(desc);
  const learned = key && st.rules[key];
  if (learned && S.byId('categories', learned)) return learned;
  const d = ' ' + normalise(desc) + ' ';
  if (TRANSFER.some(w => d.includes(w)) && S.byId('categories', 'transfer')) return 'transfer';
  for (const [id, words] of Object.entries(type === 'in' ? IN : OUT)) {
    if (words.some(w => d.includes(w)) && S.byId('categories', id)) return id;
  }
  return type === 'in' ? (S.byId('categories', 'otherin') ? 'otherin' : 'wages') : 'other';
}

// Remember a correction so the same shop is categorised the same way next time.
export function learn(desc, categoryId) {
  const key = ruleKey(desc);
  if (!key || !categoryId || S.getState().rules[key] === categoryId) return;
  S.getState().rules[key] = categoryId;
  S.getState().rulesUpdatedAt = Date.now();
}

export function merchantName(text) {
  const d = ' ' + normalise(text) + ' ';
  return MERCHANTS.find(m => d.includes(' ' + normalise(m) + ' ')) || null;
}
