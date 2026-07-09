# OutreachFlow — Personal Cold-Email & Job-Application Adaptation

**Date:** 2026-07-09
**Status:** Approved design → ready for implementation plan
**Owner:** Aashay (dragonlinea@gmail.com)

## 1. Goal

Adapt the existing client tool (`email-campaign-tool`, built by Patriot Tech Systems
for a field-services lead-gen agency) into **OutreachFlow** — a personal tool for
sending cold emails and job-application outreach. The owner will:

- Pull leads from a **personal, paid Apollo.io account** via the existing UI.
- Send **automated, scheduled emails from a personal Gmail account**.
- Add their **own email templates**.

**Guiding principle:** keep the existing, working logic intact. This is adaptation,
hardening, config, and cleanup — **not a rebuild**.

## 2. Approved decisions

| Decision | Choice | Consequence |
|---|---|---|
| Apollo source | **Paid Apollo API** | Harden the in-app search (below). Emails will actually resolve. |
| Sending account | **Primary personal Gmail** | Bake in deliverability-protecting defaults; document reputation risk + ramp-up. |
| Resume attachments | **Yes — attach resume** | Add asset upload + nodemailer attachment wiring. |
| Hosting | **Always-on Render** | Scheduler/drips fire 24/7 with managed Postgres. |
| App name | **OutreachFlow** | Rebrand across UI, `package.json`, layout. |

## 3. Current-state context (verified from code)

- **Stack:** Node/Express, EJS + Alpine.js dashboard, Postgres (`pg`) via a
  SQLite-syntax compat shim (`src/db/connection.js`), `nodemailer` for SMTP,
  `node-cron` for scheduling, JWT-cookie + API-key auth.
- **Already single-user:** `src/routes/auth.js` logs in against `APP_EMAIL`/
  `APP_PASSWORD` env vars and mints one admin JWT. No users table, no multi-tenant
  refactor needed.
- **Apollo pull works end-to-end** (`src/services/integrations/providers/apollo.js`,
  `index.js`, `_importer.js`): People Search (`/mixed_people/api_search`) → batched
  email enrichment (`/people/bulk_match`) → normalize/dedupe → import into a list,
  with a dry-run preview. Credentials AES-256-GCM encrypted at rest (`_crypto.js`).
- **Gmail sending works as-is** (`src/services/mailer.js`): generic nodemailer SMTP;
  `src/config/index.js` already defaults `SMTP_HOST=smtp.gmail.com:587`.
- **Scheduling runs** (`src/services/scheduler.js`): cron finds `status='scheduled'
  AND scheduled_at<=NOW()` campaigns every minute; advances sequence steps every 2 min.
- **Sequences/drips** (`src/services/sequenceEngine.js`): delay steps (min/hr/day/wk)
  + email/tag/list steps with `next_action_at`.
- **Templates** (`src/services/templateEngine.js`): `{{first_name}}`, dotted paths,
  `{{var|fallback}}`; open pixel / click-rewrite / UTM are gated on
  `campaign.track_opens` / `track_clicks` flags (so they can be left off).
- **Compliance plumbing:** suppression list + `List-Unsubscribe` headers +
  `/t/unsubscribe` links already wired.

## 4. Design

### 4.1 Apollo hardening (paid API)

**Files:** `src/services/integrations/providers/apollo.js`,
`src/services/integrations/index.js`, `src/services/integrations/_importer.js`,
`views/lists.ejs`, `views/integrations.ejs`.

1. **Preview stops burning enrichment credits.** Today `importFromIntegration()`
   always calls `provider.search()` (search **+** `bulk_match` enrichment) *before*
   the `dry_run` check, so previewing spends the same email-reveal credits as a real
   import. Change: pass a `skipEnrich`/`dryRun` flag through to `apollo.search()`.
   In dry-run, run **only** step 1 (People Search) and return people **without**
   emails (do not filter out no-email rows for the preview). Enrichment credits are
   spent **only** on a real import.
2. **Bounded auto-pagination.** Add a `max_results` search field (cap, e.g., 500,
   with a credit-cost note in the UI). `apollo.search()` loops pages until it has
   `max_results` usable leads or Apollo runs out, with a short delay between page
   requests to respect Apollo's per-minute limits.
3. **Surface enrichment errors.** `_bulkEnrich()` currently swallows every batch
   error in an empty `catch`. Collect batch failures and return a warning count that
   propagates to the import result, the `integration_sync_logs` row, and a UI toast.
4. **Personal-email toggle.** Expose `reveal_personal_emails` (boolean, default
   **false**) as a search field, passed through to `bulk_match`. Work emails remain
   the default (correct for both cold sales and emailing hiring managers at a company).
5. **Rebrand search placeholders.** Replace contractor-specific placeholder text
   (`"plumbing contractor"`, `"Owner, CEO, General Manager"`, `"Texas, Chicago"`) in
   `apollo.js` `meta.search_fields` with neutral examples.

### 4.2 Gmail-safe sending

**Files:** `src/config/index.js`, `render.yaml`, `src/routes/campaigns.js`,
`views/campaigns.ejs`, `src/routes/templates.js`/`views/templates.ejs`,
`src/services/templateEngine.js`, `views/settings.ejs`.

1. **Conservative rate defaults:** `SEND_RATE_PER_SECOND=1`,
   `SEND_RATE_PER_DAY=40` to start (env-driven; documented ramp-up schedule in
   Settings). Update `render.yaml` and `config`. Consumer Gmail hard-caps ~500/day;
   we start far below and ramp weekly.
2. **Tracking OFF by default** for new campaigns: `track_opens` and `track_clicks`
   default to `0` in the create route and the `views/campaigns.ejs` form (checkboxes
   unchecked). No open pixel, no link rewriting → better deliverability + a personal
   feel. Still toggleable per campaign.
3. **Plain-text-first** stays the default (already true).
4. **"Send test to myself"**: `POST /api/campaigns/:id/test-send { to }` renders the
   campaign's template (with a sample/real contact's data) and sends **one** email via
   `mailer.sendEmail`, including any attachments. A button in `views/campaign-detail.ejs`.
5. **Merge-tag safety (small polish):** default unresolved merge tags to an empty
   string so a literal `{{first_name}}` never ships in a real email.
6. **Settings note:** surface the Gmail daily cap, App-Password requirement, and
   ramp-up guidance in `views/settings.ejs`.

### 4.3 Resume attachments

**Files:** `src/db/schema.js`, `src/services/mailer.js`, `src/services/sendQueue.js`,
`src/services/sequenceEngine.js` (optional), new `src/routes/assets.js`, new
`views/assets.ejs` (or a section in Settings), `views/campaign-detail.ejs`.

1. **`assets` table** (Postgres): `id`, `name`, `filename`, `mime_type`,
   `size_bytes`, `data_base64` (TEXT — stored base64 so it survives Render's ephemeral
   disk; resume PDFs are small, cap ~5 MB), `created_at`. Upload once, reuse anywhere.
2. **`campaign_attachments`** join table (`campaign_id`, `asset_id`) — mirrors the
   `list_contacts` pattern.
3. **Mailer:** `sendEmail()` accepts `attachments` and passes them to nodemailer as
   `[{ filename, content: Buffer.from(data_base64,'base64'), contentType: mime }]`.
4. **Send path:** `processCampaign` loads the campaign's attachments once and passes
   them into each `sendEmail` call.
5. **UI:** upload/list/delete assets; attach one or more to a campaign in
   `views/campaign-detail.ejs`. (Sequence-step attachments are an **optional**
   follow-on, not v1.)

### 4.4 Rebrand & cleanup

**Files:** `package.json`, `views/layout.ejs`, `views/login.ejs`,
`views/dashboard.ejs`, `views/integrations.ejs`, `src/db/seed.js`, `README`/docs.

1. **Rename to OutreachFlow:** `package.json` (name/description/author), app title/
   logo in `layout.ejs`, headings in `login.ejs` / `dashboard.ejs`.
2. **Strip client copy:** remove "Patriot Tech", "Marcus", "Cornersight", "Field
   Services ICP" strings from the UI.
3. **Wipe client seed data** (`src/db/seed.js`): remove the 10 fake HVAC/plumbing
   contacts, vertical tags/lists, and demo campaigns/sequences. Seed clean — no
   contacts; optionally a couple of generic tags (`cold-outreach`, `job-application`).
   The owner adds their own templates.
4. **Hide unused providers** (Hunter, Clearbit, Snov.io, Lead Magic) from the
   Integrations catalog so only Apollo shows. Leave adapter files in place (harmless);
   just don't list them.

### 4.5 Bug fix — re-import into a list

**File:** `src/services/integrations/_importer.js` (and same gap in manual create,
`src/routes/contacts.js`).

Today `importLeads()` uses `INSERT OR IGNORE` and only attaches list/tags when a
**new** row is created (`result.changes > 0`). Pulling an Apollo lead you already
have into a **new** list silently fails to add them. Fix: when the contact already
exists, look it up by email and still perform the (idempotent) `list_contacts` /
`contact_tags` upserts, and recompute `lists.contact_count`.

### 4.6 Deployment (Render, always-on)

**Files:** `render.yaml`, deploy checklist doc.

Set required secrets and deploy so the scheduler fires 24/7:

- `APP_SECRET` — **strong real value** (encrypts the Apollo key + signs JWTs; the
  `dev-secret-change-me` fallback must not be used).
- `APP_EMAIL` / `APP_PASSWORD` — dashboard login.
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`,
  `SMTP_USER=<your gmail>`, `SMTP_PASS=<16-char Google App Password>` (requires 2FA on
  the Google account), `SMTP_FROM_EMAIL=<same gmail>` (must match the auth account or
  Google rewrites it), `SMTP_FROM_NAME=<your name>`.
- `DATABASE_URL` — wired from the Render Postgres service.
- `BASE_URL` — the Render URL (used by unsubscribe links).
- Rate envs from §4.2.

Get it running **locally first** to verify end-to-end, then deploy.

## 5. Non-goals (YAGNI)

- No multi-account / inbox rotation (single Gmail only).
- No dynamic-list segmentation (schema has `type='dynamic'`/`segment_rules` but no
  route evaluates them — leave as-is, unused).
- No multi-tenant / user management (single-user model kept).
- No automated Gmail warmup (manual ramp via the daily cap).
- No removal of webhooks/analytics code (left intact; not a focus).
- No sequence-step attachments in v1 (campaign-level only; optional follow-on).

## 6. Verification plan

Exercise each piece against reality (not just code review):

1. App boots locally; login works with `APP_EMAIL`/`APP_PASSWORD`.
2. Apollo **preview** returns leads and spends **no enrichment credits** (verify via
   Apollo credit usage before/after).
3. Apollo **import** brings enriched contacts (real emails) into a chosen list; a
   **re-import** of an existing contact into a **new** list adds them to that list.
4. A **test email** sends from the personal Gmail and lands in the inbox; merge tags
   render; **no** tracking pixel/links present by default.
5. A **resume PDF attachment** arrives intact on a test send.
6. A **scheduled campaign** fires at its time; the daily cap pauses it correctly.
7. A **2-step sequence** advances after its delay.
8. Deployed on Render: scheduler fires with the machine off.

## 7. Rollout order

1. Run locally + strip seed + rebrand basics (verify boot).
2. Gmail-safe defaults + test-send.
3. Apollo hardening (preview credits, pagination, errors, personal toggle, placeholders).
4. Attachments (schema + mailer + UI).
5. Re-import bug fix.
6. Deploy to Render + end-to-end verification.
