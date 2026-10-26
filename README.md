# C.A.S.H — Control All Spending Habits

A family money app for tracking spending, bills, wages, savings, your offset account and credit card. It's set up for Australia (AUD, Aussie shops, billers and banks) and works on Android phones (built with a Google Pixel in mind) and on laptops.

## What it does

| Screen | What's on it |
|---|---|
| **Home** | What's left this month, money in and out, your Offset and Credit Card balances, where the money went (by group and top categories), budget warnings, bills due, recent payments, a 6-month trend, and who spent what |
| **Activity** | Every payment for the month, grouped by day, with search and filters (in/out, category, person) |
| **Plan → Budget** | A starter Australian family budget template (Essentials, Lifestyle, Savings) that you can fully change, plus a 50/30/20 helper |
| **Plan → Bills** | Every regular bill with its due date, payment method and whose account it comes from. Tick a bill to mark it paid (this adds it to your spending). Shows monthly and yearly totals |
| **Plan → Wages** | Each wage (fortnightly by default), Family Tax Benefit or other regular income, with expected paydays and a tick for when it arrives |
| **Savings** | **Accounts**: the Offset account (balance, change since the last update, and the home-loan interest it's saving you each month) and Credit Card (amount owed, limit, what's available). Each update records who made it and keeps a history. Below that, savings pots with goals and target dates |
| **＋ button** | Add an expense, scan a receipt, read a banking screenshot, import a bank CSV, add money in, or add a bill |

### Ways to get payments in
- **Manual**: type the amount and where. C.A.S.H guesses the category (Woolworths → Groceries, Ampol → Fuel, etc.).
- **Receipt photo**: take a photo and C.A.S.H reads the shop, date, total and each item. Change the category on any item to split the receipt (e.g. groceries + dog food + paracetamol).
- **Screenshot**: screenshot your banking app's list of payments and C.A.S.H picks out each one. On Android you can also use **Share → C.A.S.H** from Photos once the app is installed.
- **Bank CSV**: export a statement from your bank and import months of payments at once. It works with NAB, CommBank, Westpac, ANZ, ING, Macquarie, Up and Amex. Columns are detected automatically, payments you've already added are spotted, and bill payments are matched to your bills.
  - **NAB Offset / Credit Card**: pick which account the statement is for (or let C.A.S.H work it out from the last 4 digits saved on the account). The latest **balance** in the file updates that account automatically.
  - **Transfers** between your own accounts (like paying off the card from the offset) are kept but never counted as spending, so nothing is counted twice.

It also learns from you. When you change a category, it remembers that shop for next time.

### Two people, two colours
Each person picks a name and a colour in Settings, and each phone is set to "who uses this phone". Everything added on that phone shows the person's name and colour on the payment, in "Who spent", and on account balance updates. Renaming someone carries their history across.

Receipts and screenshots are read **on your device** with Tesseract.js. Pictures are never uploaded anywhere.

## Why it's built this way

C.A.S.H is a **Progressive Web App (PWA)**: plain HTML, CSS and JavaScript with no build step.

- **One app for the Pixel and the laptop.** On Android, Chrome's **Install app** puts it on the home screen with its own icon. It opens full-screen like a normal app and works offline.
- **No app store**, no developer fees, and no waiting for approval. You get updates as soon as you publish them.
- The camera, file picker, Android share sheet and app shortcuts (long-press the icon) all work.
- Hosting is free (see below).

A native Android app (Kotlin or Flutter) would only be worth it later if you need things a web app can't do, such as reading bank notifications automatically.

## Running it on this laptop

```bash
python -m http.server 8080
```
Then open http://localhost:8080 (run the command from inside this folder).

## Putting it on your phones (free hosting)

The camera and "Install app" need **HTTPS**, so host it somewhere. Either of these is free:

**GitHub Pages**
1. Create a repository (e.g. `cash`) and push this folder to it.
2. Go to Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://<your-username>.github.io/cash/` on the Pixel, tap ⋮ → **Install app**.

**Netlify Drop**: drag this folder onto https://app.netlify.com/drop.

## Two people, one budget

**Right now** each phone keeps its own copy of the data (saved in the browser on that device). To copy everything between phones, use Settings → **Back up** on one and **Restore** on the other.

**GitHub vs Supabase:** they do different jobs, and you'd use both.
- **GitHub Pages** hosts the *app itself* (the files), for free. It can't store live shared data. Keeping money data in a GitHub repo would mean storing a secret access key on both phones, and you'd get no logins and no live updates, so don't use it for that.
- **Supabase** stores the *shared data* (a real database with logins). The free plan should cover a family. Free projects pause after about a week of no use, which won't happen if you use it daily. Security: each of you signs in, row-level security means only your household's rows can be read, and data is encrypted in transit and at rest.
- For money data, C.A.S.H only ever stores **amounts, descriptions and balances**: never card numbers, bank logins or passwords. Accounts keep just the last 4 digits.

### Setting up live family sync (about 15 minutes, free)

You'll need the app hosted first (see "Putting it on your phones"), because your partner's phone can't reach `localhost` on this laptop.

**1. Create the Supabase project (on a laptop)**
1. Go to https://supabase.com, click **Start your project** and sign up. Signing in with GitHub is easiest.
2. Click **New project**: name it `cash`, pick region **Sydney**, and set a strong database password. Keep that password safe; the app doesn't use it.
3. When the project is ready, open **SQL Editor → New query**, paste everything from [`supabase/setup.sql`](supabase/setup.sql) and click **Run**. You should see "Success".
4. Go to **Authentication → URL Configuration** and set **Site URL** to your app's web address (e.g. `https://yourname.github.io/cash/`). This is where the "confirm your email" link sends you.
5. Go to **Project Settings → API** (may be called **API Keys**) and copy the **Project URL** and the **anon public** key (newer projects call it the **publishable** key, starting `sb_publishable_`).
   - ⚠️ Never use the **service_role** / **secret** key in the app.

**2. Connect the app**
- Put the URL and key in [`js/config.js`](js/config.js) and publish the app again, so neither of you types them. Or paste them into **Settings → Family sync → Connect** on each phone.

**3. You (the first person)**
1. Settings → Family sync → enter your email and a password → **Create my login**. Confirm the email Supabase sends you, then **Sign in**.
2. Tap **Start our household**. Everything on your phone is uploaded and you'll see a **join code**.

**4. Your partner**
1. Open the app on her phone, do the quick welcome, then Settings → Family sync → **Create my login** with *her own* email, confirm it, then sign in.
2. Enter your join code → **Join household**. Her phone now shows the shared data.
3. In Settings, set **Who uses this phone** to her name and pick her colour.

**5. Lock it down**
- In Supabase: **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**. Now nobody else can even create a login on your project.

**How it behaves**
- Every change syncs within a couple of seconds, and the other phone updates live.
- Offline? Keep using it. It catches up when you're back online.
- If you both edit the same thing, the most recent edit wins.
- The green dot by the ⚙️ means up to date, amber means offline or waiting, red means there's a problem (open Settings to see what).
- The free plan pauses a project after about a week with no use. Restore it from the Supabase dashboard; nothing is lost.

## Files

```
index.html              app shell
css/styles.css          design (light + dark mode)
js/app.js               routing, events, start-up
js/store.js             data model, saving, budget template
js/views.js             Home, Activity, Plan, Savings, Settings screens
js/sheets.js            add/edit forms
js/flows.js             receipt + screenshot reading (OCR) and CSV import
js/calc.js              money maths, bill schedules, duplicate detection
js/categorise.js        auto-categorising rules for Australian shops and billers
js/charts.js            donut + bar charts
js/demo.js              demo household
js/sync.js              family sync with Supabase (push, pull, live updates)
js/config.js            your Supabase project URL + public key
supabase/setup.sql      one-off database setup to paste into Supabase
sw.js                   offline support + Android share target
manifest.webmanifest    install settings, icons, shortcuts
icons/                  logo (SVG) and app icons (PNG)
```
