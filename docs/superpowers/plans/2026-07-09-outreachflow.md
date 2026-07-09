# OutreachFlow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the existing client `email-campaign-tool` into **OutreachFlow** — a personal cold-email + job-application tool that pulls leads from a paid Apollo.io account, sends scheduled emails from a personal Gmail, and supports resume attachments — keeping all existing logic intact.

**Architecture:** Node/Express + EJS/Alpine.js dashboard, Postgres via a better-sqlite3-style facade (`src/db/connection.js`), nodemailer SMTP, node-cron scheduler. Changes are surgical: config defaults, UI copy, two bug/credit fixes, and one new feature (attachments). No structural rewrite.

**Tech Stack:** Node ≥18, Express 4, Postgres (`pg`), nodemailer, node-cron, EJS, Alpine.js, multer (already a dependency). Tests use the built-in `node:test` runner (no new dependency).

## Global Constraints

- **App name is `OutreachFlow`** in all user-facing copy (page titles, sidebar, login).
- **Node ≥18** (`package.json` engines). Tests run via `node --test` — no Jest/Mocha.
- **Keep existing logic.** This is adaptation, not a rewrite. Do not remove webhooks/analytics/sequence code.
- **Gmail-safe defaults:** send rate defaults `SEND_RATE_PER_SECOND=1`, `SEND_RATE_PER_DAY=40`; new campaigns default **tracking OFF** (`track_opens=0`, `track_clicks=0`).
- **Attachments are stored as base64 TEXT in Postgres** (Render's disk is ephemeral). Max ~5 MB per asset.
- **DB facade rules:** `db.prepare(sql)` is sync; `.run/.get/.all(...)` are async and MUST be awaited. `.run()` returns `{ changes, lastInsertRowid }`. `INSERT OR IGNORE` is written verbatim (auto-translated to `ON CONFLICT DO NOTHING`); on conflict `changes===0` and `lastInsertRowid===undefined`. **Any new id-less join table must be added to `TABLES_WITHOUT_ID` in `connection.js`** or its inserts error with "column id does not exist".
- **`SMTP_FROM_EMAIL` must equal the authenticated Gmail** or Google rewrites the From.
- All app paths are under `D:/AB - dev local/outbound-flow-marcus/email-campaign-tool/`.

## Testing Strategy (read before starting)

This codebase has **no existing tests** and is Postgres-backed. We add automated `node:test` unit tests only for **pure logic** that we change (merge-tag rendering, Apollo search with mocked `fetch`, mailer attachment shaping with a stubbed nodemailer transport). For **DB-, route-, and EJS-level changes**, the deliverable is verified by **driving the running app** (documented manual verification with exact commands and expected observations) — standing up a throwaway Postgres test harness is disproportionate for a personal tool. Every task states which mode it uses.

**Prerequisite for manual verification:** a local Postgres and a `.env` with at least `DATABASE_URL`, `APP_SECRET`, `APP_EMAIL`, `APP_PASSWORD`. Task 0 sets this up.

---

## Task 0: Local run + test harness

**Files:**
- Create: `email-campaign-tool/.env` (local only, git-ignored)
- Create: `email-campaign-tool/test/smoke.test.js`
- Modify: `email-campaign-tool/package.json` (add `test` script)

**Interfaces:**
- Produces: `npm test` runs the `node:test` suite; a working local app on `http://localhost:3000`.

- [ ] **Step 1: Confirm `.gitignore` excludes `.env`**

Run: `cat "D:/AB - dev local/outbound-flow-marcus/.gitignore"`
Expected: contains `.env` (or `*.env`). If not, add a line `.env` before creating the file.

- [ ] **Step 2: Create a local `.env`** (fill in your own Postgres + Gmail values)

```
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000
APP_SECRET=local-dev-secret-change-me-32chars-min
APP_EMAIL=you@gmail.com
APP_PASSWORD=choose-a-dashboard-password
DATABASE_URL=postgres://postgres:postgres@localhost:5432/outreachflow
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your-16-char-google-app-password
SMTP_FROM_EMAIL=you@gmail.com
SMTP_FROM_NAME=Your Name
SEND_RATE_PER_SECOND=1
SEND_RATE_PER_DAY=40
```

- [ ] **Step 3: Install deps and create the database**

Run: `cd "D:/AB - dev local/outbound-flow-marcus/email-campaign-tool" && npm install`
Then create the empty DB (adjust to your Postgres): `createdb outreachflow` (or via psql `CREATE DATABASE outreachflow;`).
Expected: `npm install` completes; database `outreachflow` exists.

- [ ] **Step 4: Add the `test` script to package.json**

In `email-campaign-tool/package.json`, in `"scripts"`, add:

```json
    "test": "node --test",
```

- [ ] **Step 5: Create a smoke test**

Create `email-campaign-tool/test/smoke.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('node:test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 6: Run the test suite**

Run: `cd "D:/AB - dev local/outbound-flow-marcus/email-campaign-tool" && npm test`
Expected: `# pass 1` (or similar), exit code 0.

- [ ] **Step 7: Boot the app**

Run: `npm run dev` (leave running), then open `http://localhost:3000`.
Expected: redirect to `/login`; the schema auto-creates on boot (`initializeSchema`); logging in with `APP_EMAIL`/`APP_PASSWORD` reaches the dashboard. Stop the server (Ctrl-C) when confirmed.

- [ ] **Step 8: Commit**

```bash
git add email-campaign-tool/package.json email-campaign-tool/test/smoke.test.js
git commit -m "chore: add node:test harness and smoke test"
```

---

## Task 1: Rebrand to OutreachFlow

**Files:**
- Modify: `email-campaign-tool/package.json`
- Modify: `email-campaign-tool/views/layout.ejs:6,23,24`
- Modify: `email-campaign-tool/views/login.ejs:6,16`

**Interfaces:**
- Produces: user-facing name is "OutreachFlow" everywhere. (No code interface.)

Verification mode: **manual** (visual — the pages render the new name).

- [ ] **Step 1: Rename in `package.json`**

Change the top fields:

```json
  "name": "outreachflow",
  "version": "1.0.0",
  "description": "OutreachFlow — personal cold-email and job-application outreach: Apollo lead pulls, Gmail sending, scheduling, sequences, and attachments",
```

And change `"author"` to your name (e.g. `"author": "Aashay Bhujbal"`).

- [ ] **Step 2: Rename the layout title + sidebar** (`views/layout.ejs`)

Line 6 — change `Email Campaign Tool` to `OutreachFlow`:

```html
  <title><%= typeof title !== 'undefined' ? title + ' | ' : '' %>OutreachFlow</title>
```

Lines 22–25 — change the sidebar header:

```html
      <div class="p-5 border-b border-gray-200">
        <h1 class="text-xl font-bold text-gray-800"><i class="fas fa-paper-plane text-blue-500 mr-2"></i>OutreachFlow</h1>
        <p class="text-xs text-gray-400 mt-1">Personal Outreach</p>
      </div>
```

- [ ] **Step 3: Rename the login page** (`views/login.ejs`)

Line 6:

```html
  <title>Login | OutreachFlow</title>
```

Line 16 (heading inside the login card):

```html
      <h1 class="text-2xl font-bold text-gray-800">OutreachFlow</h1>
```

- [ ] **Step 4: Verify**

Run: `npm run dev`, open `http://localhost:3000/login`.
Expected: login card shows "OutreachFlow"; after login the browser tab title and sidebar read "OutreachFlow". Stop the server.

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/package.json email-campaign-tool/views/layout.ejs email-campaign-tool/views/login.ejs
git commit -m "feat: rebrand app to OutreachFlow"
```

---

## Task 2: Wipe client seed data → clean minimal seed

**Files:**
- Modify: `email-campaign-tool/src/db/seed.js` (replace the whole `seed()` body's data blocks)

**Interfaces:**
- Produces: `npm run db:seed` inserts only 1 generic starter template + 2 generic tags; no contacts, lists, campaigns, events, stats, or sequences.

Verification mode: **manual** (run seed, inspect the app has no client data).

Decision (from brainstorming): keep **one** de-branded starter template as a reference and two generic tags; wipe everything else.

- [ ] **Step 1: Replace the body of `seed()`**

Replace everything in `src/db/seed.js` between the line `const db = getDb();` (line 8) and the line `await closeDb();` (line 312) with:

```js
  // ─── Starter template (generic, de-branded) ───────────────────────
  await db.transaction(async () => {
    await db.prepare(`
      INSERT OR IGNORE INTO templates (name, subject, html_content, text_content, category, variables)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'Cold Outreach (starter)',
      'Quick question, {{first_name}}',
      '',
      "Hi {{first_name|there}},\n\nI came across {{company}} and wanted to reach out.\n\n[Write your pitch here.]\n\nBest,\nYour Name\n\n{{unsubscribe_link}}",
      'outreach',
      '["first_name","company","unsubscribe_link"]'
    );
  })();
  console.log('Seeded 1 starter template');

  // ─── Generic tags ─────────────────────────────────────────────────
  const tags = [
    { name: 'cold-outreach', color: '#6B7280' },
    { name: 'job-application', color: '#2563EB' },
  ];
  await db.transaction(async () => {
    for (const t of tags) {
      await db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)').run(t.name, t.color);
    }
  })();
  console.log(`Seeded ${tags.length} tags`);
```

(This removes all client tags, lists, fake contacts, the assignment loop, demo campaigns, events, daily_stats, and both sequences. `plainTextToHtml` is applied by the templates route on real use; the starter's empty `html_content` is fine.)

- [ ] **Step 2: Reset + seed the database**

Run: `cd "D:/AB - dev local/outbound-flow-marcus/email-campaign-tool" && npm run db:reset && npm run db:seed`
Expected: console prints "Seeded 1 starter template" and "Seeded 2 tags"; no errors.

- [ ] **Step 3: Verify no client data**

Run: `psql "$DATABASE_URL" -c "SELECT count(*) FROM contacts; SELECT count(*) FROM campaigns; SELECT name FROM tags;"`
Expected: `contacts=0`, `campaigns=0`, tags are exactly `cold-outreach` and `job-application`.

- [ ] **Step 4: Commit**

```bash
git add email-campaign-tool/src/db/seed.js
git commit -m "feat: replace client seed data with clean minimal seed"
```

---

## Task 3: Gmail-safe send-rate defaults

**Files:**
- Modify: `email-campaign-tool/src/config/index.js:35-36`
- Modify: `render.yaml:91-94`

**Interfaces:**
- Produces: `config.sendRate.perSecond` defaults to 1, `config.sendRate.perDay` defaults to 40 when env unset.

Verification mode: **automated** (unit-assert the defaults with env unset).

- [ ] **Step 1: Write the failing test**

Create `email-campaign-tool/test/config.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('send-rate defaults are Gmail-safe when env unset', () => {
  delete process.env.SEND_RATE_PER_SECOND;
  delete process.env.SEND_RATE_PER_DAY;
  delete require.cache[require.resolve('../src/config')];
  const config = require('../src/config');
  assert.equal(config.sendRate.perSecond, 1);
  assert.equal(config.sendRate.perDay, 40);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/config.test.js` (or `node --test test/config.test.js`)
Expected: FAIL — perSecond is 5, perDay is 2000.

- [ ] **Step 3: Change the defaults** (`src/config/index.js:34-37`)

```js
  sendRate: {
    perSecond: parseInt(process.env.SEND_RATE_PER_SECOND, 10) || 1,
    perDay: parseInt(process.env.SEND_RATE_PER_DAY, 10) || 40,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config.test.js`
Expected: PASS.

- [ ] **Step 5: Update `render.yaml`** (lines 91-94)

```yaml
      - key: SEND_RATE_PER_SECOND
        value: "1"
      - key: SEND_RATE_PER_DAY
        value: "40"
```

- [ ] **Step 6: Commit**

```bash
git add email-campaign-tool/src/config/index.js email-campaign-tool/test/config.test.js render.yaml
git commit -m "feat: Gmail-safe send-rate defaults (1/sec, 40/day)"
```

---

## Task 4: Default open/click tracking OFF

**Files:**
- Modify: `email-campaign-tool/src/db/schema.js:132-133`
- Modify: `email-campaign-tool/src/routes/campaigns.js:87`
- Modify: `email-campaign-tool/views/campaigns.ejs:152,178` (Alpine state) and insert checkbox markup before line 132

**Interfaces:**
- Produces: a campaign created with no tracking fields in the request has `track_opens=0, track_clicks=0`.

Verification mode: **manual** (create a campaign via UI, confirm flags are 0).

- [ ] **Step 1: Change schema defaults** (`src/db/schema.js:132-133`)

```sql
      track_opens     INTEGER DEFAULT 0,
      track_clicks    INTEGER DEFAULT 0,
```

- [ ] **Step 2: Change the create-route destructure default** (`src/routes/campaigns.js:87`)

```js
      scheduled_at, track_opens = 0, track_clicks = 0,
```

(Line 113 already coerces `track_opens ? 1 : 0` — a client sending `false`/omitting now yields 0.)

- [ ] **Step 3: Add tracking checkboxes to the create form** (`views/campaigns.ejs`)

Insert this block immediately after the "Email Body" `</div>` (currently closing at line 130) and before the button row `<div class="flex items-center justify-end gap-3 mt-6">` (line 132):

```html
          <div class="col-span-2 flex items-center gap-6 pt-1">
            <label class="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" x-model="form.track_opens" class="rounded border-gray-300" />
              Track opens
            </label>
            <label class="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" x-model="form.track_clicks" class="rounded border-gray-300" />
              Track clicks (rewrites links)
            </label>
            <span class="text-xs text-gray-400">Off is recommended for personal cold email.</span>
          </div>
```

- [ ] **Step 4: Add the Alpine state (default unchecked)** (`views/campaigns.ejs:152`)

Change the `form:` initializer to include the tracking keys:

```js
    form: { name: '', subject: '', from_name: '', reply_to: '', template_id: '', list_id: '', text_content: '', track_opens: false, track_clicks: false },
```

- [ ] **Step 5: Keep the reset object in sync** (`views/campaigns.ejs:178`, inside `createCampaign()`)

Replace the reset line so it matches Step 4's keys (note: use `text_content`, not `html_content`):

```js
        this.form = { name: '', subject: '', from_name: '', reply_to: '', template_id: '', list_id: '', text_content: '', track_opens: false, track_clicks: false };
```

- [ ] **Step 6: Verify**

Run: `npm run dev`, go to Campaigns → New Campaign. Confirm the "Track opens/clicks" checkboxes are **unchecked** by default. Create a test campaign, then:
Run: `psql "$DATABASE_URL" -c "SELECT name, track_opens, track_clicks FROM campaigns ORDER BY id DESC LIMIT 1;"`
Expected: `track_opens=0, track_clicks=0`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add email-campaign-tool/src/db/schema.js email-campaign-tool/src/routes/campaigns.js email-campaign-tool/views/campaigns.ejs
git commit -m "feat: default open/click tracking OFF for new campaigns"
```

---

## Task 5: Merge-tag no-leak

**Files:**
- Modify: `email-campaign-tool/src/services/templateEngine.js:15`
- Test: `email-campaign-tool/test/templateEngine.test.js`

**Interfaces:**
- Produces: `renderTemplate(str, vars)` — unresolved `{{var}}` with no fallback renders `''` (never a literal `{{var}}`).

Verification mode: **automated (TDD)**.

- [ ] **Step 1: Write the failing test**

Create `email-campaign-tool/test/templateEngine.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTemplate } = require('../src/services/templateEngine');

test('unresolved tag with no fallback renders empty (not literal)', () => {
  assert.equal(renderTemplate('Hi {{first_name}}, welcome', {}), 'Hi , welcome');
});

test('fallback is still used when provided', () => {
  assert.equal(renderTemplate('Hi {{first_name|there}}', {}), 'Hi there');
});

test('value is used when present', () => {
  assert.equal(renderTemplate('Hi {{first_name}}', { first_name: 'Sam' }), 'Hi Sam');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/templateEngine.test.js`
Expected: FAIL — first test gets `Hi {{first_name}}, welcome`.

- [ ] **Step 3: Change the fallback branch** (`src/services/templateEngine.js:15`)

```js
    return fallback !== undefined ? fallback : '';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/templateEngine.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/src/services/templateEngine.js email-campaign-tool/test/templateEngine.test.js
git commit -m "fix: render unresolved merge tags as empty instead of leaking literal braces"
```

---

## Task 6: "Send test to myself" route + button

**Files:**
- Modify: `email-campaign-tool/src/routes/campaigns.js` (add requires at top; add route after line 215)
- Modify: `email-campaign-tool/views/campaign-detail.ejs` (button in action bar ~line 13; `sendTest()` method ~line 142)

**Interfaces:**
- Produces: `POST /api/campaigns/:id/test-send { to? }` → sends one rendered email to `to` (default `APP_EMAIL`); returns `{ message, messageId }` or `{ error }`.

Verification mode: **manual** (click the button, confirm the email arrives).

- [ ] **Step 1: Add requires** (`src/routes/campaigns.js`, after line 8)

Add these three lines below the existing requires:

```js
const config = require('../config');
const { buildEmail } = require('../services/templateEngine');
const { sendEmail } = require('../services/mailer');
```

- [ ] **Step 2: Add the test-send route** (insert after the `POST '/:id/send'` route closes at line 215, before `POST '/:id/pause'`)

```js
router.post('/:id/test-send', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const campaign = await db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const to = (req.body && req.body.to) || config.appEmail;
    if (!to) return res.status(400).json({ error: 'No recipient — pass "to" or set APP_EMAIL.' });

    let template = { html_content: '', text_content: '', subject: '' };
    if (campaign.template_id) {
      template = (await db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id)) || template;
    }

    const sampleContact = {
      id: 0, email: to, first_name: 'there', last_name: '',
      company: 'Acme', title: '', custom_fields: '{}',
    };
    const email = buildEmail(campaign, sampleContact, template);

    const result = await sendEmail({
      to,
      subject: `[TEST] ${email.subject}`,
      html: email.html,
      text: email.text,
      from: campaign.from_name
        ? `"${campaign.from_name}" <${campaign.from_email || config.smtp.fromEmail}>`
        : undefined,
      replyTo: campaign.reply_to || undefined,
    });

    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ message: `Test email sent to ${to}`, messageId: result.messageId });
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Add the button** (`views/campaign-detail.ejs`, inside the action `flex` row, after the Schedule button at line 13)

```html
      <button @click="sendTest()" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300">
        <i class="fas fa-vial mr-1"></i> Send test to me
      </button>
```

- [ ] **Step 4: Add the Alpine method** (`views/campaign-detail.ejs`, next to `sendNow()` ~line 142)

```js
    async sendTest() {
      try {
        const data = await api.post(`/api/campaigns/${campaignId}/test-send`, {});
        toast(data.message || 'Test sent');
      } catch (e) {}
    },
```

- [ ] **Step 5: Verify (real Gmail send)**

Run: `npm run dev`. Create a campaign with a template or body text and a subject, open its detail page, click **Send test to me**.
Expected: toast "Test email sent to …"; the email arrives in your Gmail inbox with `[TEST]` subject, merge tags rendered, and no tracking pixel/links. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add email-campaign-tool/src/routes/campaigns.js email-campaign-tool/views/campaign-detail.ejs
git commit -m "feat: send a test email to yourself from a campaign"
```

---

## Task 7: Apollo — dry-run preview skips enrichment (credit-safety)

**Files:**
- Modify: `email-campaign-tool/src/services/integrations/providers/apollo.js` (search signature + dry-run branch)
- Modify: `email-campaign-tool/src/services/integrations/index.js:112` (thread `dryRun` into `provider.search`)
- Test: `email-campaign-tool/test/apollo.test.js`

**Interfaces:**
- Consumes: `importFromIntegration` calls `provider.search(creds, params, { dryRun })`.
- Produces: `apollo.search(creds, params, options?)` — when `options.dryRun` is true, calls **only** `/mixed_people/api_search` (no `/people/bulk_match`), returns `{ leads, pagination, total }` with un-enriched leads (email may be `''`, rows are NOT filtered by email).

Verification mode: **automated (TDD, mocked `fetch`)**.

- [ ] **Step 1: Write the failing test**

Create `email-campaign-tool/test/apollo.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const apollo = require('../src/services/integrations/providers/apollo');

function mockFetch(handlers) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    const path = url.replace('https://api.apollo.io/api/v1', '');
    const h = handlers[path];
    const data = typeof h === 'function' ? h(body) : h;
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  return calls;
}

test('dry run does NOT call bulk_match enrichment', async () => {
  const calls = mockFetch({
    '/mixed_people/api_search': { people: [{ id: 'p1', first_name: 'A', last_name: 'B' }], pagination: { total_entries: 1 } },
    '/people/bulk_match': { matches: [] },
  });
  const res = await apollo.search({ api_key: 'k' }, { per_page: 25 }, { dryRun: true });
  const urls = calls.map(c => c.url);
  assert.ok(urls.some(u => u.includes('api_search')), 'api_search should be called');
  assert.ok(!urls.some(u => u.includes('bulk_match')), 'bulk_match must NOT be called on dry run');
  assert.equal(res.leads.length, 1, 'preview keeps rows even without email');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/apollo.test.js`
Expected: FAIL — `bulk_match` is called (current code always enriches).

- [ ] **Step 3: Add a `dryRun` option to `apollo.search`** (`src/services/integrations/providers/apollo.js`)

Change the signature (line 113) to accept options, and after Step-1's `api_search` call (currently line 132) branch on dry-run **before** enrichment. Replace the block from `const data = await _request(creds, '/mixed_people/api_search', body);` through the `return` at the end of `search` with:

```js
  // Step 1: Search (returns people WITHOUT emails)
  const data = await _request(creds, '/mixed_people/api_search', body);
  const people = Array.isArray(data?.people) ? data.people : [];
  const apiTotal = data?.pagination?.total_entries ?? data?.total_entries ?? 0;

  if (!people.length) {
    return { leads: [], pagination: data?.pagination || null, total: apiTotal };
  }

  // Dry-run preview: skip bulk_match enrichment entirely (saves email credits).
  if (options.dryRun) {
    const leads = people.map(p => _mapLead(p, {}));
    return { leads, pagination: data?.pagination || null, total: apiTotal };
  }

  // Step 2: Enrich in batches of 10 to get emails
  const enrichedPeople = await _bulkEnrich(creds, people);
  const enrichedMap = new Map();
  for (const ep of enrichedPeople) {
    if (ep.id) enrichedMap.set(ep.id, ep);
  }

  const leads = people
    .map(p => _mapLead(p, enrichedMap.get(p.id) || {}))
    .filter(l => l.email && l.email !== 'email_not_unlocked@domain.com');

  return { leads, pagination: data?.pagination || null, total: apiTotal };
```

Change the signature line to:

```js
async function search(creds, params = {}, options = {}) {
```

- [ ] **Step 4: Extract the lead-mapping into `_mapLead`** (add near `_bulkEnrich`, replacing the inline merge that previously lived in `search`)

```js
function _mapLead(p, enriched) {
  const email = enriched.email || p.email || '';
  return {
    email,
    first_name: enriched.first_name || p.first_name || '',
    last_name: enriched.last_name || p.last_name || '',
    title: enriched.title || p.title || '',
    company: enriched.organization?.name || p.organization?.name || '',
    industry: p.organization?.industry || '',
    city: enriched.city || p.city || '',
    state: enriched.state || p.state || '',
    country: enriched.country || p.country || '',
    phone: enriched.phone_numbers?.[0]?.sanitized_number || enriched.phone || '',
    custom_fields: {
      apollo_id: p.id,
      linkedin_url: enriched.linkedin_url || p.linkedin_url || '',
      organization_website: enriched.organization?.website_url || p.organization?.website_url || '',
    },
  };
}
```

- [ ] **Step 5: Thread `dryRun` into the search call** (`src/services/integrations/index.js:112`)

```js
    const result = await provider.search(creds, params, { dryRun: dry_run });
```

(The other caller `searchIntegration` at line 90 passes no options — `options` defaults to `{}`, so it stays back-compatible.)

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/apollo.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add email-campaign-tool/src/services/integrations/providers/apollo.js email-campaign-tool/src/services/integrations/index.js email-campaign-tool/test/apollo.test.js
git commit -m "fix: Apollo dry-run preview skips email enrichment to save credits"
```

---

## Task 8: Apollo — bounded auto-pagination via `max_results`

**Files:**
- Modify: `email-campaign-tool/src/services/integrations/providers/apollo.js` (search loop, `sleep` helper, `meta.search_fields`)
- Test: `email-campaign-tool/test/apollo.test.js` (add cases)

**Interfaces:**
- Consumes: `params.max_results` (number; default = `per_page`; hard-capped at 500).
- Produces: `apollo.search` pages `api_search` until it has `max_results` people or Apollo is exhausted, then enriches (real import) / maps (dry run). Single-page behavior is unchanged when `max_results` ≤ `per_page`.

Verification mode: **automated (TDD, mocked `fetch`)**.

- [ ] **Step 1: Add the failing pagination test** (append to `test/apollo.test.js`)

```js
test('auto-paginates up to max_results (real import)', async () => {
  const pageSize = 2;
  const calls = mockFetch({
    '/mixed_people/api_search': (body) => {
      const page = body.page;
      if (page > 3) return { people: [], pagination: { total_entries: 6, page } };
      const base = (page - 1) * pageSize;
      const people = [base, base + 1].map(i => ({ id: 'p' + i, first_name: 'F' + i }));
      return { people, pagination: { total_entries: 6, page } };
    },
    '/people/bulk_match': (body) => ({ matches: body.details.map(d => ({ id: d.id, email: d.id + '@x.com' })) }),
  });
  const res = await apollo.search({ api_key: 'k' }, { per_page: 2, max_results: 5 });
  const searchCalls = calls.filter(c => c.url.includes('api_search'));
  assert.ok(searchCalls.length >= 3, 'should fetch at least 3 pages');
  assert.ok(res.leads.length >= 5, 'should collect at least max_results leads');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/apollo.test.js`
Expected: FAIL — only one `api_search` page is fetched.

- [ ] **Step 3: Add a `sleep` helper** (top of `apollo.js`, after `BASE_URL`)

```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 4: Replace the single `api_search` call with a bounded paging loop**

Replace the `search` body from the `body` construction down to the point just before the dry-run branch with:

```js
async function search(creds, params = {}, options = {}) {
  const perPage = Math.max(1, Math.min(parseInt(params.per_page, 10) || 25, 100));
  const startPage = Math.max(1, parseInt(params.page, 10) || 1);
  const maxResults = Math.max(1, Math.min(parseInt(params.max_results, 10) || perPage, 500));
  const MAX_PAGES = 20; // hard safety cap on API calls per search

  const body = { page: startPage, per_page: perPage };
  if (params.q_keywords) body.q_keywords = params.q_keywords;
  const titles = splitList(params.person_titles);
  if (titles) body.person_titles = titles;
  const locations = splitList(params.person_locations);
  if (locations) body.person_locations = locations;
  const orgLocations = splitList(params.organization_locations);
  if (orgLocations) body.organization_locations = orgLocations;
  const seniorities = splitList(params.person_seniorities);
  if (seniorities) body.person_seniorities = seniorities;
  const ranges = splitList(params.organization_num_employees_ranges);
  if (ranges) body.organization_num_employees_ranges = ranges;

  // Step 1: Search (paged) — collect people up to maxResults.
  let allPeople = [];
  let apiTotal = 0;
  let lastPagination = null;
  for (let i = 0; i < MAX_PAGES && allPeople.length < maxResults; i++) {
    body.page = startPage + i;
    const data = await _request(creds, '/mixed_people/api_search', body);
    const people = Array.isArray(data?.people) ? data.people : [];
    apiTotal = data?.pagination?.total_entries ?? data?.total_entries ?? apiTotal;
    lastPagination = data?.pagination || lastPagination;
    if (!people.length) break;
    allPeople.push(...people);
    if (people.length < perPage) break; // last page reached
    if (allPeople.length < maxResults) await sleep(250); // be gentle on Apollo rate limits
  }
  allPeople = allPeople.slice(0, maxResults);

  if (!allPeople.length) {
    return { leads: [], pagination: lastPagination, total: apiTotal };
  }

  // Dry-run preview: skip bulk_match enrichment entirely (saves email credits).
  if (options.dryRun) {
    const leads = allPeople.map((p) => _mapLead(p, {}));
    return { leads, pagination: lastPagination, total: apiTotal };
  }

  // Step 2: Enrich in batches of 10 to get emails
  const enrichedPeople = await _bulkEnrich(creds, allPeople);
  const enrichedMap = new Map();
  for (const ep of enrichedPeople) {
    if (ep.id) enrichedMap.set(ep.id, ep);
  }

  const leads = allPeople
    .map((p) => _mapLead(p, enrichedMap.get(p.id) || {}))
    .filter((l) => l.email && l.email !== 'email_not_unlocked@domain.com');

  return { leads, pagination: lastPagination, total: apiTotal };
}
```

- [ ] **Step 5: Add the `max_results` field to `meta.search_fields`** (after the `per_page` entry)

```js
    { key: 'max_results', label: 'Max results to pull (uses credits)', type: 'number', default: 25 },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/apollo.test.js`
Expected: PASS (dry-run + pagination + any earlier cases).

- [ ] **Step 7: Commit**

```bash
git add email-campaign-tool/src/services/integrations/providers/apollo.js email-campaign-tool/test/apollo.test.js
git commit -m "feat: Apollo bounded auto-pagination via max_results"
```

---

## Task 9: Apollo — personal-email toggle, error surfacing, de-branded placeholders

**Files:**
- Modify: `email-campaign-tool/src/services/integrations/providers/apollo.js` (`_bulkEnrich`, `search`, `meta`)
- Test: `email-campaign-tool/test/apollo.test.js` (add case)

**Interfaces:**
- Consumes: `params.reveal_personal_emails` (boolean; default false).
- Produces: `_bulkEnrich(creds, people, revealPersonal)` returns `{ matches, failedBatches }`; `apollo.search` return includes `enrich_errors` (number of failed enrichment batches). The `bulk_match` request body carries `reveal_personal_emails` from the param.

Verification mode: **automated (TDD, mocked `fetch`)**.

- [ ] **Step 1: Add the failing test** (append to `test/apollo.test.js`)

```js
test('reveal_personal_emails flag threads into bulk_match', async () => {
  const calls = mockFetch({
    '/mixed_people/api_search': { people: [{ id: 'p1' }], pagination: { total_entries: 1 } },
    '/people/bulk_match': { matches: [{ id: 'p1', email: 'p1@x.com' }] },
  });
  await apollo.search({ api_key: 'k' }, { per_page: 25, reveal_personal_emails: true });
  const match = calls.find(c => c.url.includes('bulk_match'));
  assert.equal(match.body.reveal_personal_emails, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/apollo.test.js`
Expected: FAIL — `reveal_personal_emails` is hard-coded `false`.

- [ ] **Step 3: Update `_bulkEnrich` to accept the flag and report failures** (`src/services/integrations/providers/apollo.js:86-106`)

```js
async function _bulkEnrich(creds, people, revealPersonal = false) {
  if (!people.length) return { matches: [], failedBatches: 0 };

  const enriched = [];
  let failedBatches = 0;
  for (let i = 0; i < people.length; i += 10) {
    const batch = people.slice(i, i + 10);
    const details = batch.map((p) => ({ id: p.id }));
    try {
      const data = await _request(creds, '/people/bulk_match', {
        details,
        reveal_personal_emails: !!revealPersonal,
      });
      const matches = Array.isArray(data?.matches) ? data.matches : [];
      enriched.push(...matches);
    } catch (err) {
      failedBatches++;
    }
  }
  return { matches: enriched, failedBatches };
}
```

- [ ] **Step 4: Wire the flag + errors through `search`** (in the Step-2 enrichment section from Task 8)

```js
  // Step 2: Enrich in batches of 10 to get emails
  const revealPersonal = params.reveal_personal_emails === true || params.reveal_personal_emails === 'true';
  const { matches: enrichedPeople, failedBatches } = await _bulkEnrich(creds, allPeople, revealPersonal);
  const enrichedMap = new Map();
  for (const ep of enrichedPeople) {
    if (ep.id) enrichedMap.set(ep.id, ep);
  }

  const leads = allPeople
    .map((p) => _mapLead(p, enrichedMap.get(p.id) || {}))
    .filter((l) => l.email && l.email !== 'email_not_unlocked@domain.com');

  return { leads, pagination: lastPagination, total: apiTotal, enrich_errors: failedBatches };
```

- [ ] **Step 5: Add the `reveal_personal_emails` field + de-brand placeholders** (`meta.search_fields`)

Replace the placeholder text in the existing fields with neutral examples and add the toggle. The full array becomes:

```js
  search_fields: [
    { key: 'q_keywords', label: 'Keywords', type: 'text', placeholder: 'e.g. fintech, SaaS, logistics' },
    { key: 'person_titles', label: 'Job Titles (comma-separated)', type: 'text',
      placeholder: 'Founder, CTO, Engineering Manager, Recruiter' },
    { key: 'person_locations', label: 'Person Location (comma-separated)', type: 'text',
      placeholder: 'United States, London, Remote' },
    { key: 'organization_locations', label: 'Company HQ Location (comma-separated)', type: 'text',
      placeholder: 'United States, San Francisco' },
    { key: 'organization_num_employees_ranges', label: 'Employee Range', type: 'text',
      placeholder: '1,10  or  11,50' },
    { key: 'person_seniorities', label: 'Seniority (comma-separated)', type: 'text',
      placeholder: 'owner, founder, c_suite, vp, director, manager' },
    { key: 'page', label: 'Start Page', type: 'number', default: 1 },
    { key: 'per_page', label: 'Per Page (max 100)', type: 'number', default: 25 },
    { key: 'max_results', label: 'Max results to pull (uses credits)', type: 'number', default: 25 },
    { key: 'reveal_personal_emails', label: 'Include personal emails (uses more credits)', type: 'checkbox', default: false },
  ],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/apollo.test.js`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add email-campaign-tool/src/services/integrations/providers/apollo.js email-campaign-tool/test/apollo.test.js
git commit -m "feat: Apollo personal-email toggle, enrichment error surfacing, neutral placeholders"
```

---

## Task 10: Apollo UI — checkbox field + surface enrich warnings + Apollo-only catalog

**Files:**
- Modify: `email-campaign-tool/views/lists.ejs` (field renderer ~line 216-225; `apolloPreview`/`apolloImport` toast ~line 534-568)
- Modify: `email-campaign-tool/views/integrations.ejs` (`load()` provider filter ~line 274-285; header copy line 5-6; name placeholder line 86)

**Interfaces:**
- Consumes: `apollo.js meta.search_fields` including the `checkbox`-type field and `enrich_errors` in the import response.
- Produces: the Lists Apollo modal renders a checkbox for `reveal_personal_emails`; import/preview toasts warn when `enrich_errors > 0`; Integrations shows only Apollo.

Verification mode: **manual** (visual + a real Apollo preview).

- [ ] **Step 1: Render checkboxes in the Lists Apollo modal** (`views/lists.ejs`, the `x-for` field loop at lines 219-227)

Replace the single-input `<template x-for>` body with a type-aware version:

```html
          <template x-for="field in apolloSearchFields" :key="field.key">
            <div :class="field.type === 'checkbox' ? 'md:col-span-2 flex items-center gap-2' : ''">
              <template x-if="field.type === 'checkbox'">
                <label class="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" x-model="apolloParams[field.key]" class="rounded border-gray-300" />
                  <span x-text="field.label"></span>
                </label>
              </template>
              <template x-if="field.type !== 'checkbox'">
                <div>
                  <label class="block text-xs font-medium text-gray-700 mb-1" x-text="field.label"></label>
                  <input :type="field.type || 'text'" x-model="apolloParams[field.key]"
                         :placeholder="field.placeholder || ''"
                         class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </template>
            </div>
          </template>
```

- [ ] **Step 2: Surface enrichment warnings in the toasts** (`views/lists.ejs`)

In `apolloPreview()` change the success toast (line ~546) to:

```js
        this.apolloResult = r;
        const warn = r.enrich_errors ? ` (⚠ ${r.enrich_errors} enrichment batches failed)` : '';
        toast(`Preview: ${r.total_results || r.total} found, ${r.imported} new${warn}`);
```

In `apolloImport()`, after the result is returned, add the same warning to its toast (mirror the existing success toast, appending `warn`).

- [ ] **Step 3: Show only Apollo in Integrations** (`views/integrations.ejs`, `load()` at line ~281)

```js
        this.providers = (b.providers || []).filter(p => p.id === 'apollo');
```

- [ ] **Step 4: De-brand Integrations copy**

Line 4-5 (header description) → replace with:

```html
      <p class="text-sm text-gray-500">Connect your Apollo.io account to pull contacts directly into your lists.</p>
```

Line 86 (name placeholder) → replace with:

```html
            <input type="text" x-model="form.name" required placeholder="e.g. My Apollo Account" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
```

- [ ] **Step 5: Verify**

Run: `npm run dev`. On Integrations, confirm only Apollo appears. Add your Apollo API key. On a list, open **Apollo Search** — confirm the "Include personal emails" checkbox renders and "Max results" appears. Run a **Preview** with a small query (`per_page` 5, `max_results` 5).
Expected: preview returns rows without spending enrichment credits (verify Apollo credit usage is unchanged). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add email-campaign-tool/views/lists.ejs email-campaign-tool/views/integrations.ejs
git commit -m "feat: Apollo modal checkbox field, enrichment warnings, Apollo-only catalog"
```

---

## Task 11: Attachments schema — `assets` + `campaign_attachments`

**Files:**
- Modify: `email-campaign-tool/src/db/schema.js` (add two tables inside the `db.exec` block, before the closing backtick at line 364)
- Modify: `email-campaign-tool/src/db/connection.js:107` (add `campaign_attachments` to `TABLES_WITHOUT_ID`)

**Interfaces:**
- Produces: tables `assets(id, name, filename, mime_type, size_bytes, data_base64, created_at)` and `campaign_attachments(campaign_id, asset_id)`.

Verification mode: **manual** (run schema init, confirm tables exist).

- [ ] **Step 1: Add the tables** (`src/db/schema.js`, insert before the closing ``` ` ``` of the `db.exec` template at line 364)

```sql
    -- ═══════════════════════════════════════════════════════════
    -- ASSETS (uploaded files, e.g. resume PDFs) + campaign links
    -- ═══════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS assets (
      id              BIGSERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      filename        TEXT NOT NULL DEFAULT '',
      mime_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes      INTEGER DEFAULT 0,
      data_base64     TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaign_attachments (
      campaign_id     BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      asset_id        BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      PRIMARY KEY (campaign_id, asset_id)
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_attachments_asset ON campaign_attachments(asset_id);
```

- [ ] **Step 2: Register the id-less join table** (`src/db/connection.js:107`)

```js
const TABLES_WITHOUT_ID = new Set(['list_contacts', 'contact_tags', 'campaign_attachments']);
```

- [ ] **Step 3: Apply the schema and verify tables exist**

Run: `cd "D:/AB - dev local/outbound-flow-marcus/email-campaign-tool" && node -e "require('dotenv').config(); const {initDb,closeDb}=require('./src/db/connection'); const {initializeSchema}=require('./src/db/schema'); (async()=>{await initDb(); await initializeSchema(); await closeDb(); console.log('schema ok');})();"`
Then: `psql "$DATABASE_URL" -c "\dt assets" -c "\dt campaign_attachments"`
Expected: both tables listed.

- [ ] **Step 4: Commit**

```bash
git add email-campaign-tool/src/db/schema.js email-campaign-tool/src/db/connection.js
git commit -m "feat: add assets + campaign_attachments tables"
```

---

## Task 12: Mailer — attachment pass-through

**Files:**
- Modify: `email-campaign-tool/src/services/mailer.js:32,36-49`
- Test: `email-campaign-tool/test/mailer.test.js`

**Interfaces:**
- Produces: `sendEmail({ ..., attachments })` forwards `attachments` to `nodemailer.sendMail` as a top-level array of `{ filename, content, contentType }`.

Verification mode: **automated (TDD, stubbed nodemailer)**.

- [ ] **Step 1: Write the failing test**

Create `email-campaign-tool/test/mailer.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const mailer = require('../src/services/mailer');

test('attachments are passed through to nodemailer', async () => {
  let captured = null;
  const orig = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    sendMail: async (opts) => { captured = opts; return { messageId: 'x' }; },
    verify: async () => true,
    close: () => {},
  });
  mailer.closeTransporter(); // clear cached transport so the stub is used

  const atts = [{ filename: 'resume.pdf', content: Buffer.from('hi'), contentType: 'application/pdf' }];
  const res = await mailer.sendEmail({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't', attachments: atts });

  nodemailer.createTransport = orig;
  mailer.closeTransporter();

  assert.equal(res.success, true);
  assert.ok(Array.isArray(captured.attachments));
  assert.equal(captured.attachments[0].filename, 'resume.pdf');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mailer.test.js`
Expected: FAIL — `captured.attachments` is undefined.

- [ ] **Step 3: Accept and forward attachments** (`src/services/mailer.js`)

Line 32 — add `attachments = []` to the destructure:

```js
async function sendEmail({ to, subject, html, text, from, replyTo, headers = {}, attachments = [] }) {
```

In the `mailOptions` object (lines 36-49), add an `attachments` field (e.g. right after `text,`):

```js
    text,
    attachments,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mailer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/src/services/mailer.js email-campaign-tool/test/mailer.test.js
git commit -m "feat: mailer forwards attachments to nodemailer"
```

---

## Task 13: Assets router — upload / list / delete

**Files:**
- Create: `email-campaign-tool/src/routes/assets.js`
- Modify: `email-campaign-tool/src/server.js:88` (mount the router)

**Interfaces:**
- Consumes: multer (already a dependency), `getDb`, `authenticate`, `requirePermission`.
- Produces: `POST /api/assets` (multipart `file`, optional `name`) → `{ asset }` (without `data_base64`); `GET /api/assets` → `{ assets }` (metadata only); `DELETE /api/assets/:id`.

Verification mode: **manual** (upload a resume, list it, delete it).

- [ ] **Step 1: Create the assets router** (`src/routes/assets.js`)

```js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { getDb } = require('../db/connection');
const { authenticate, requirePermission } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate);

// List assets (metadata only — never send data_base64 in the list)
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    const assets = await db.prepare(
      'SELECT id, name, filename, mime_type, size_bytes, created_at FROM assets ORDER BY created_at DESC'
    ).all();
    res.json({ assets });
  } catch (err) { next(err); }
});

// Upload an asset
router.post('/', requirePermission('write'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name "file")' });
    const db = getDb();
    const name = (req.body && req.body.name) || req.file.originalname;
    const dataBase64 = req.file.buffer.toString('base64');
    const result = await db.prepare(`
      INSERT INTO assets (name, filename, mime_type, size_bytes, data_base64)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, req.file.originalname, req.file.mimetype, req.file.size, dataBase64);
    const asset = await db.prepare(
      'SELECT id, name, filename, mime_type, size_bytes, created_at FROM assets WHERE id = ?'
    ).get(result.lastInsertRowid);
    res.status(201).json({ asset });
  } catch (err) { next(err); }
});

// Delete an asset
router.delete('/:id', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 2: Mount the router** (`src/server.js`, in the API mount block after line 88 `/api/integrations`)

```js
app.use('/api/assets', require('./routes/assets'));
```

- [ ] **Step 3: Verify (real upload)**

Run: `npm run dev`. Then in a second terminal (logged-in cookie required — easiest is to test via the UI added in Task 14, but you can smoke it with curl using an API key if configured). Minimal check now:
Run: `curl -s -b "token=<paste your session cookie>" -F "file=@/path/to/resume.pdf" http://localhost:3000/api/assets`
Expected: JSON `{ "asset": { "id":…, "filename":"resume.pdf", "mime_type":"application/pdf", … } }`. Then `GET /api/assets` lists it. Stop the server.

(If cookie-based curl is awkward, defer this verification to Task 14 where the UI drives it.)

- [ ] **Step 4: Commit**

```bash
git add email-campaign-tool/src/routes/assets.js email-campaign-tool/src/server.js
git commit -m "feat: assets router for file upload/list/delete"
```

---

## Task 14: Wire attachments into sends + campaign UI

**Files:**
- Modify: `email-campaign-tool/src/services/sendQueue.js:96-99,149-162` (load + pass attachments)
- Modify: `email-campaign-tool/src/routes/campaigns.js` (attach/detach routes; include attachments in test-send)
- Modify: `email-campaign-tool/views/campaign-detail.ejs` (Attachments card + Alpine methods)

**Interfaces:**
- Consumes: `campaign_attachments`, `assets`, `sendEmail({attachments})` from Task 12.
- Produces: `GET/POST/DELETE /api/campaigns/:id/attachments`; `processCampaign` attaches campaign assets to every message; test-send includes them.

Verification mode: **manual** (attach resume, send test, confirm the PDF arrives).

- [ ] **Step 1: Add a helper to load a campaign's attachments** (`src/services/sendQueue.js`, near the top after the requires)

```js
async function loadCampaignAttachments(db, campaignId) {
  const rows = await db.prepare(`
    SELECT a.filename, a.mime_type, a.data_base64
    FROM campaign_attachments ca
    JOIN assets a ON a.id = ca.asset_id
    WHERE ca.campaign_id = ?
  `).all(campaignId);
  return rows.map(r => ({
    filename: r.filename,
    content: Buffer.from(r.data_base64, 'base64'),
    contentType: r.mime_type,
  }));
}
```

- [ ] **Step 2: Load attachments once in `processCampaign`** (`src/services/sendQueue.js`, right after the template load block at lines 96-99)

```js
    const campaignAttachments = await loadCampaignAttachments(db, campaignId);
```

- [ ] **Step 3: Pass attachments into the send** (`src/services/sendQueue.js:149-162`, add to the `sendEmail({…})` object)

Add `attachments: campaignAttachments,` to the object (e.g. after the `headers: { … }` block):

```js
          headers: {
            'X-Campaign-ID': String(campaignId),
            'List-Unsubscribe': `<${unsubUrl}>`,
          },
          attachments: campaignAttachments,
        });
```

- [ ] **Step 4: Add attach/detach/list routes** (`src/routes/campaigns.js`, add before `module.exports = router;` at line 327)

```js
router.get('/:id/attachments', async (req, res, next) => {
  try {
    const db = getDb();
    const assets = await db.prepare(`
      SELECT a.id, a.name, a.filename, a.mime_type, a.size_bytes
      FROM campaign_attachments ca JOIN assets a ON a.id = ca.asset_id
      WHERE ca.campaign_id = ?
    `).all(req.params.id);
    res.json({ assets });
  } catch (err) { next(err); }
});

router.post('/:id/attachments', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    const assetId = req.body && req.body.asset_id;
    if (!assetId) return res.status(400).json({ error: 'asset_id is required' });
    await db.prepare('INSERT OR IGNORE INTO campaign_attachments (campaign_id, asset_id) VALUES (?, ?)')
      .run(parseInt(req.params.id, 10), parseInt(assetId, 10));
    res.json({ message: 'Attachment added' });
  } catch (err) { next(err); }
});

router.delete('/:id/attachments/:assetId', requirePermission('write'), async (req, res, next) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM campaign_attachments WHERE campaign_id = ? AND asset_id = ?')
      .run(parseInt(req.params.id, 10), parseInt(req.params.assetId, 10));
    res.json({ message: 'Attachment removed' });
  } catch (err) { next(err); }
});
```

- [ ] **Step 5: Include attachments in the test-send route** (`src/routes/campaigns.js`, in the Task-6 test-send route)

Before the `sendEmail({…})` call, load attachments:

```js
    const attachRows = await db.prepare(`
      SELECT a.filename, a.mime_type, a.data_base64
      FROM campaign_attachments ca JOIN assets a ON a.id = ca.asset_id
      WHERE ca.campaign_id = ?
    `).all(campaign.id);
    const attachments = attachRows.map(r => ({
      filename: r.filename, content: Buffer.from(r.data_base64, 'base64'), contentType: r.mime_type,
    }));
```

And add `attachments,` to the test-send `sendEmail({…})` object.

- [ ] **Step 6: Add the Attachments card** (`views/campaign-detail.ejs`, after the Top Links/Recent Activity grid closes at line 101)

```html
  <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mt-6">
    <h3 class="text-sm font-semibold text-gray-700 mb-4">Attachments</h3>
    <div class="flex items-center gap-3 mb-4">
      <input type="file" @change="uploadAsset($event)" class="text-sm" />
    </div>
    <div class="space-y-2">
      <template x-for="a in attachments" :key="a.id">
        <div class="flex items-center justify-between p-2 rounded hover:bg-gray-50">
          <span class="text-sm text-gray-700"><i class="fas fa-paperclip mr-2 text-gray-400"></i><span x-text="a.filename"></span></span>
          <button @click="detachAsset(a.id)" class="text-xs text-red-500 hover:underline">Remove</button>
        </div>
      </template>
      <p x-show="!attachments.length" class="text-sm text-gray-400">No attachments</p>
    </div>
  </div>
```

- [ ] **Step 7: Add Alpine state + methods** (`views/campaign-detail.ejs`, in `campaignDetail()`)

Add `attachments: [],` to the returned state, call `this.loadAttachments()` inside `loadCampaign()`, and add:

```js
    async loadAttachments() {
      const data = await api.get(`/api/campaigns/${campaignId}/attachments`);
      this.attachments = data.assets || [];
    },
    async uploadAsset(e) {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      try {
        const { asset } = await api.upload('/api/assets', fd);
        await api.post(`/api/campaigns/${campaignId}/attachments`, { asset_id: asset.id });
        toast('Attachment added');
        this.loadAttachments();
        e.target.value = '';
      } catch (err) { toast('Upload failed', 'error'); }
    },
    async detachAsset(assetId) {
      await api.del(`/api/campaigns/${campaignId}/attachments/${assetId}`);
      this.loadAttachments();
    },
```

The `api` helper is defined in `views/layout.ejs:96-127` and provides `api.get`, `api.post`, `api.put`, `api.del`, and `api.upload(url, formData)` (multipart POST returning parsed JSON) — all used above.

- [ ] **Step 8: Verify (end-to-end attachment)**

Run: `npm run dev`. Open a campaign detail page, upload a resume PDF in the Attachments card, then click **Send test to me**.
Expected: the test email arrives in your Gmail **with the PDF attached** and opens correctly. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add email-campaign-tool/src/services/sendQueue.js email-campaign-tool/src/routes/campaigns.js email-campaign-tool/views/campaign-detail.ejs
git commit -m "feat: campaign attachments wired into sends, test-send, and UI"
```

---

## Task 15: Fix re-import into a list (existing contacts)

**Files:**
- Modify: `email-campaign-tool/src/services/integrations/_importer.js:132-154`

**Interfaces:**
- Produces: `importLeads` — when a contact already exists, it is still added to the target `list_id`/`tags` (idempotently).

Verification mode: **manual** (import a lead into list A, re-import into list B, confirm membership in both).

- [ ] **Step 1: Add a shared attach helper** (`src/services/integrations/_importer.js`, above `importLeads`)

```js
async function attachToListAndTags(db, contactId, list_id, tags) {
  if (list_id) {
    await db.prepare('INSERT OR IGNORE INTO list_contacts (list_id, contact_id) VALUES (?, ?)').run(parseInt(list_id, 10), contactId);
  }
  if (Array.isArray(tags) && tags.length) {
    for (const name of tags) {
      const tagName = String(name).trim();
      if (!tagName) continue;
      await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName);
      const tag = await db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
      if (tag) {
        await db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(contactId, tag.id);
      }
    }
  }
}
```

- [ ] **Step 2: Use it in both branches** (replace lines 132-154, the `if (result.changes > 0) { … } else { skipped++; }` block)

```js
        if (result.changes > 0) {
          imported++;
          const contactId = result.lastInsertRowid;
          importedContacts.push({ id: contactId, email: c.email });
          await attachToListAndTags(db, contactId, list_id, tags);
        } else {
          // Contact already exists — INSERT OR IGNORE returned 0 rows, so we
          // resolve its id and still add it to the target list/tags.
          skipped++;
          if (list_id || (Array.isArray(tags) && tags.length)) {
            const existing = await db.prepare('SELECT id FROM contacts WHERE email = ?').get(c.email);
            if (existing) await attachToListAndTags(db, existing.id, list_id, tags);
          }
        }
```

- [ ] **Step 3: Verify (re-import adds to new list)**

Run: `npm run dev`. Create list "A" and list "B". Use Apollo (or CSV import) to import a small set into "A". Then import the **same** query/CSV into "B".
Run: `psql "$DATABASE_URL" -c "SELECT l.name, count(*) FROM list_contacts lc JOIN lists l ON l.id=lc.list_id GROUP BY l.name;"`
Expected: the same contacts now appear in **both** A and B (counts > 0 for both). Stop the server.

- [ ] **Step 4: Commit**

```bash
git add email-campaign-tool/src/services/integrations/_importer.js
git commit -m "fix: re-importing an existing contact still adds it to the target list/tags"
```

---

## Task 16: Settings guidance + Render deploy + end-to-end verification

**Files:**
- Modify: `email-campaign-tool/views/settings.ejs` (add a Gmail/ramp guidance card after the System Info card, line ~60)
- Modify: `render.yaml` (confirm secrets; already updated in Task 3)
- Create: `email-campaign-tool/DEPLOY-OUTREACHFLOW.md` (deploy checklist)

**Interfaces:**
- Produces: deployed always-on Render service; documented go-live checklist.

Verification mode: **manual** (deploy, confirm scheduled send fires).

- [ ] **Step 1: Add the guidance card** (`views/settings.ejs`, after the System Info card closes at line 60, before the grid `</div>` at line 61)

```html
    <!-- Gmail sending guidance -->
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 class="font-semibold text-gray-700 mb-4"><i class="fas fa-shield-halved text-gray-400 mr-2"></i>Gmail Sending &amp; Deliverability</h3>
      <ul class="text-sm text-gray-600 space-y-2 list-disc pl-5">
        <li>Personal Gmail caps at ~500 recipients/day. Current cap: <span class="font-mono"><%= typeof send_daily !== 'undefined' ? send_daily : '-' %>/day</span>.</li>
        <li>Start low (~40/day) and raise by ~10–20/day each week to protect your inbox reputation.</li>
        <li>Keep open/click tracking <strong>off</strong> for cold email — it hurts deliverability and looks like marketing.</li>
        <li>Requires a Google <strong>App Password</strong> (2FA must be enabled). <code>SMTP_FROM_EMAIL</code> must match your Gmail address.</li>
      </ul>
    </div>
```

- [ ] **Step 2: Write the deploy checklist** (`email-campaign-tool/DEPLOY-OUTREACHFLOW.md`)

```markdown
# OutreachFlow — Render Deploy Checklist

1. Push this repo to GitHub.
2. Render → New → Blueprint → connect the repo (root `render.yaml`).
   Render provisions the web service + managed Postgres.
3. Set the `sync:false` env vars in the Render dashboard:
   - APP_SECRET  (a strong random 32+ char string — NOT the dev default)
   - APP_EMAIL / APP_PASSWORD  (your dashboard login)
   - BASE_URL  (your Render URL, e.g. https://outreachflow.onrender.com)
   - SMTP_USER  (your Gmail), SMTP_PASS (16-char Google App Password),
     SMTP_FROM_EMAIL (= your Gmail), SMTP_FROM_NAME (your name)
   - TRACKING_DOMAIN  (= BASE_URL; only used if you turn tracking on)
   (SEND_RATE_PER_SECOND=1, SEND_RATE_PER_DAY=40, SMTP_HOST/PORT are already in render.yaml.)
4. Deploy. On first boot the schema auto-creates.
5. Run the seed once (optional) via a Render shell: `npm run db:seed`.
6. Log in, add your Apollo API key on Integrations, upload your resume on a campaign, send a test to yourself.
7. Enable 2FA + App Password on the Gmail account first, or SMTP auth will fail.
```

- [ ] **Step 3: Full local regression before deploy**

Run: `cd "D:/AB - dev local/outbound-flow-marcus/email-campaign-tool" && npm test`
Expected: all `node:test` suites pass.

Then manually walk the golden path locally (server running):
- Apollo preview (no credit burn) → import into a list.
- Create a campaign (tracking off), attach resume, send test to yourself → arrives with PDF.
- Schedule the campaign 2 minutes out → the cron fires and it sends.
- Build a 2-step sequence with a short delay → step advances.

- [ ] **Step 4: Deploy to Render** and confirm a scheduled send fires with your PC off.

Expected: a campaign scheduled for a near-future time sends from the Render instance (check the recipient inbox and the campaign status → `sent`).

- [ ] **Step 5: Commit**

```bash
git add email-campaign-tool/views/settings.ejs email-campaign-tool/DEPLOY-OUTREACHFLOW.md
git commit -m "docs: Gmail guidance in settings + Render deploy checklist"
```

---

## Spec Coverage Check

| Spec §4 item | Task |
|---|---|
| 4.1 Preview skips enrichment | Task 7 |
| 4.1 Bounded auto-pagination | Task 8 |
| 4.1 Surface enrichment errors | Task 9, 10 |
| 4.1 Personal-email toggle | Task 9, 10 |
| 4.1 Rebrand search placeholders | Task 9 |
| 4.2 Conservative rate defaults | Task 3 |
| 4.2 Tracking OFF by default | Task 4 |
| 4.2 Send test to myself | Task 6 |
| 4.2 Merge-tag safety | Task 5 |
| 4.2 Settings guidance | Task 16 |
| 4.3 Resume attachments (schema/mailer/UI/send) | Tasks 11–14 |
| 4.4 Rebrand + strip client copy | Tasks 1, 9, 10 |
| 4.4 Wipe seed data | Task 2 |
| 4.4 Hide unused providers | Task 10 |
| 4.5 Re-import into list fix | Task 15 |
| 4.6 Render deploy | Task 16 |
| 4.7 Verification | Each task's verify step + Task 16 |

**Note on §4.5 manual-create gap:** the spec mentions the same list/tag gap in `src/routes/contacts.js` manual create (returns 409 on duplicate, no attach). This plan fixes the Apollo/CSV path (`_importer.js`, Task 15) — the path you actually use for pulling leads. The manual-create UI edge case is deferred; revisit if it becomes a real workflow.
